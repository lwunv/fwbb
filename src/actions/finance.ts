"use server";

import { db } from "@/db";
import {
  sessions,
  sessionAttendees,
  sessionDebts,
  members,
  financialTransactions,
  fundMembers,
} from "@/db/schema";
import { eq, desc, and, isNull, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";
import {
  calculateSessionCosts,
  type AttendeeInput,
} from "@/lib/cost-calculator";
import { isFundMember } from "@/lib/fund-calculator";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getAdminFromCookie, requireAdmin } from "@/lib/auth";
import { sendGroupMessage, buildDebtReminderMessage } from "@/lib/messenger";
import { finalizeSessionSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";

export interface FinalizeAttendee {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
}

export async function finalizeSession(
  sessionId: number,
  attendeeList: FinalizeAttendee[],
  diningBill: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  // 0. Validate input via Zod
  const parsed = finalizeSessionSchema.safeParse({
    sessionId,
    attendeeList,
    diningBill,
  });
  if (!parsed.success) {
    return {
      error: "Dữ liệu không hợp lệ: " + parsed.error.issues[0]?.message,
    };
  }
  const data = parsed.data;

  // 1. Load session with shuttlecocks
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    with: { shuttlecocks: true },
  });

  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "cancelled")
    return { error: "Buoi choi da bi huy — khong the chot so" };
  if (!session.courtPrice) return { error: "Chua thiet lap gia san" };
  // Re-finalize a completed session (e.g., admin edited attendee list after
  // initial close) is intentionally allowed: the tx below reverses old
  // fund_deductions, nulls orphan debt-scoped ledger refs, deletes stale
  // attendees/debts, then re-creates everything from the new payload.

  // Resolve admin's member record outside the tx (read-only).
  // Hardened: only auto-confirm if exactly ONE member matches the admin username,
  // to avoid confirming wrong member's debt when names collide.
  const adminMemberId = await resolveAdminMemberId();

  // Always require admin to be linked to a member record when finalizing —
  // otherwise the cost-distribution loop below treats admin's own row as a
  // regular member and creates a debt + fund_deduction for them, effectively
  // making admin "pay themselves". Failing fast here forces the admin to fix
  // the linkage first.
  if (adminMemberId === null) {
    return {
      error:
        "Admin chưa được liên kết với member — vào /admin/members để gắn member của admin trước khi chốt sổ",
    };
  }

  // Hard guard: admin set N guests on the session UI, but the finalize
  // payload must include those N guest rows under the admin's invitedById.
  // Without this check, `setAdminGuestCount` could silently drop guests from
  // the cost-divisor → other members overpay.
  const expectedAdminGuestPlay = session.adminGuestPlayCount ?? 0;
  const expectedAdminGuestDine = session.adminGuestDineCount ?? 0;
  if (expectedAdminGuestPlay > 0 || expectedAdminGuestDine > 0) {
    const adminGuestPlayInPayload = data.attendeeList.filter(
      (a) => a.isGuest && a.invitedById === adminMemberId && a.attendsPlay,
    ).length;
    const adminGuestDineInPayload = data.attendeeList.filter(
      (a) => a.isGuest && a.invitedById === adminMemberId && a.attendsDine,
    ).length;
    if (adminGuestPlayInPayload < expectedAdminGuestPlay) {
      return {
        error: `Thiếu khách của admin: cần ${expectedAdminGuestPlay} người chơi, payload chỉ có ${adminGuestPlayInPayload}`,
      };
    }
    if (adminGuestDineInPayload < expectedAdminGuestDine) {
      return {
        error: `Thiếu khách của admin: cần ${expectedAdminGuestDine} người ăn, payload chỉ có ${adminGuestDineInPayload}`,
      };
    }
  }

  // Compute costs once
  const attendeeInputs: AttendeeInput[] = data.attendeeList.map((a) => ({
    memberId: a.memberId,
    guestName: a.guestName,
    invitedById: a.invitedById,
    isGuest: a.isGuest,
    attendsPlay: a.attendsPlay,
    attendsDine: a.attendsDine,
  }));
  const shuttlecockInputs = session.shuttlecocks.map((s) => ({
    quantityUsed: s.quantityUsed,
    pricePerTube: s.pricePerTube,
  }));
  const breakdown = calculateSessionCosts(
    { courtPrice: session.courtPrice, diningBill: data.diningBill },
    attendeeInputs,
    shuttlecockInputs,
  );

  const now = new Date().toISOString();

  // Merged Quỹ + Nợ model: every non-admin member is auto-enrolled in the fund
  // and the FULL session debt is deducted via fund_deduction. Balance can go
  // negative — that negative number is the unified "còn nợ".
  const memberIdsToEnroll = new Set<number>();
  for (const debt of breakdown.memberDebts) {
    if (debt.memberId !== adminMemberId) {
      const inFund = await isFundMember(debt.memberId);
      if (!inFund) memberIdsToEnroll.add(debt.memberId);
    }
  }

  // === All mutating operations atomic via transaction ===
  try {
    await db.transaction(async (tx) => {
      // 2. Reverse prior fund deductions (idempotent — skip already reversed)
      const priorFundDeductions = await tx.query.financialTransactions.findMany(
        {
          where: and(
            eq(financialTransactions.sessionId, data.sessionId),
            eq(financialTransactions.type, "fund_deduction"),
            isNull(financialTransactions.reversalOfId),
          ),
        },
      );
      for (const ftx of priorFundDeductions) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ftx.id),
        });
        if (!alreadyReversed) {
          const r = await recordFinancialTransaction(
            {
              type: "fund_contribution",
              direction: "in",
              amount: ftx.amount,
              memberId: ftx.memberId,
              sessionId: ftx.sessionId,
              reversalOfId: ftx.id,
              description: `Hoàn lại khoản trừ quỹ khi chốt lại buổi ${session.date}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }
      }

      // Wipe stale attendees + debts for clean re-finalize. Before deleting
      // sessionDebts, NULL out `debtId` on any debt-scoped ledger rows
      // pointing at them — otherwise we'd leave orphan refs (libsql doesn't
      // enforce FK by default; reconcile invariant I7 would flag them and
      // the audit trail becomes noisy).
      await tx
        .update(financialTransactions)
        .set({ debtId: null })
        .where(eq(financialTransactions.sessionId, data.sessionId));
      await tx
        .delete(sessionAttendees)
        .where(eq(sessionAttendees.sessionId, data.sessionId));
      await tx
        .delete(sessionDebts)
        .where(eq(sessionDebts.sessionId, data.sessionId));

      // 3. Insert attendees
      for (const a of data.attendeeList) {
        await tx.insert(sessionAttendees).values({
          sessionId: data.sessionId,
          memberId: a.memberId,
          guestName: a.guestName ?? null,
          invitedById: a.invitedById,
          isGuest: a.isGuest,
          attendsPlay: a.attendsPlay,
          attendsDine: a.attendsDine,
        });
      }

      // 3.5. Auto-enroll missing members into fund (merged model: everyone is
      // a fund member; balance can go negative).
      for (const memberId of memberIdsToEnroll) {
        await tx
          .insert(fundMembers)
          .values({ memberId, isActive: true, joinedAt: now })
          .onConflictDoNothing();
      }

      // 4. For each attendee: deduct FULL debt amount from fund. The session
      // debt row is still recorded (audit) but immediately marked as confirmed
      // — the unified "còn nợ" lives on the fund balance, not on per-session
      // unpaid rows.
      for (const debt of breakdown.memberDebts) {
        const isAdminDebt = debt.memberId === adminMemberId;
        const fundDeductionAmount = isAdminDebt ? 0 : debt.totalAmount;

        const [insertedDebt] = await tx
          .insert(sessionDebts)
          .values({
            sessionId: data.sessionId,
            memberId: debt.memberId,
            playAmount: debt.playAmount,
            dineAmount: debt.dineAmount,
            guestPlayAmount: debt.guestPlayAmount,
            guestDineAmount: debt.guestDineAmount,
            totalAmount: debt.totalAmount,
            memberConfirmed: true,
            memberConfirmedAt: now,
            adminConfirmed: true,
            adminConfirmedAt: now,
          })
          .returning({ id: sessionDebts.id });

        const r1 = await recordFinancialTransaction(
          {
            type: "debt_created",
            direction: "neutral",
            amount: debt.totalAmount,
            memberId: debt.memberId,
            sessionId: data.sessionId,
            debtId: insertedDebt.id,
            description: `Phát sinh công nợ buổi ${session.date}`,
            metadata: {
              playAmount: debt.playAmount,
              dineAmount: debt.dineAmount,
              guestPlayAmount: debt.guestPlayAmount,
              guestDineAmount: debt.guestDineAmount,
            },
          },
          tx,
        );
        if ("error" in r1) throw new Error(r1.error);

        if (fundDeductionAmount > 0) {
          const r2 = await recordFinancialTransaction(
            {
              type: "fund_deduction",
              direction: "out",
              amount: fundDeductionAmount,
              memberId: debt.memberId,
              sessionId: data.sessionId,
              debtId: insertedDebt.id,
              description: `Trừ quỹ buổi ${session.date}`,
            },
            tx,
          );
          if ("error" in r2) throw new Error(r2.error);
        }
      }

      // 5. Mark session completed
      await tx
        .update(sessions)
        .set({
          diningBill: data.diningBill,
          status: "completed",
          updatedAt: now,
        })
        .where(eq(sessions.id, data.sessionId));
    });
  } catch (err) {
    return {
      error:
        "Không chốt được buổi: " +
        (err instanceof Error ? err.message : "lỗi không xác định"),
    };
  }

  // Non-blocking Messenger notification (only if tx succeeded)
  const totalDebts = breakdown.memberDebts.reduce(
    (sum, d) => sum + d.totalAmount,
    0,
  );
  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/my-debts`;
  sendGroupMessage(buildDebtReminderMessage(session.date, totalDebts, link));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  revalidatePath("/my-debts");
  revalidatePath("/my-fund");
  return { success: true, breakdown };
}

/**
 * Resolve admin's member record. Prefers the explicit `admins.memberId` FK;
 * falls back to matching `admins.username === members.name` ONLY when exactly
 * one member matches (to avoid auto-confirming the wrong member's debt when
 * names collide).
 */
async function resolveAdminMemberId(): Promise<number | null> {
  const admin = await db.query.admins.findFirst();
  if (!admin) return null;
  if (admin.memberId != null) return admin.memberId;
  const matches = await db.query.members.findMany({
    where: eq(members.name, admin.username),
    columns: { id: true },
  });
  if (matches.length !== 1) return null;
  return matches[0].id;
}

export async function confirmPaymentByMember(debtId: number) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui lòng xác định danh tính trước" };

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: "debtId không hợp lệ" };
  }

  // 30 confirm-payment attempts per member per minute (prevents ledger-spam
  // via repeated re-confirms even if the idempotent guard short-circuits).
  const rl = await checkRateLimit(
    `confirm-payment:${user.memberId}`,
    30,
    60_000,
  );
  if (!rl.ok) {
    return { error: `Quá nhiều thao tác, thử lại sau ${rl.retryAfter ?? 60}s` };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
    with: { session: true },
  });
  if (!debt) return { error: "Khong tim thay cong no" };
  if (debt.memberId !== user.memberId) {
    return { error: "Không thể xác nhận thay người khác" };
  }
  // Idempotent: re-confirm is no-op (prevents ledger spam by spamming the button).
  if (debt.memberConfirmed) return { success: true };
  if (debt.session.status === "cancelled") {
    return { error: "Buổi chơi đã bị huỷ" };
  }
  if (debt.session.status !== "completed") {
    return { error: "Chỉ xác nhận thanh toán sau khi buổi đã chốt sổ" };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sessionDebts)
        .set({
          memberConfirmed: true,
          memberConfirmedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessionDebts.id, debtId));

      const r = await recordFinancialTransaction(
        {
          type: "debt_member_confirmed",
          direction: "in",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Thành viên xác nhận đã chuyển khoản",
          // Belt-and-suspenders against a parallel double-submit slipping past
          // the early-return idempotent guard above.
          idempotencyKey: `debt-member-confirm-${debtId}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Không xác nhận được thanh toán",
    };
  }

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/history");
  revalidatePath("/");
  return { success: true };
}

export async function confirmPaymentByAdmin(debtId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: "debtId không hợp lệ" };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: "Khong tim thay cong no" };
  if (debt.adminConfirmed) return { success: true };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sessionDebts)
        .set({
          adminConfirmed: true,
          adminConfirmedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessionDebts.id, debtId));

      const r = await recordFinancialTransaction(
        {
          type: "debt_admin_confirmed",
          direction: "in",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Admin xác nhận đã nhận tiền",
          idempotencyKey: `debt-admin-confirm-${debtId}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Không xác nhận được thanh toán",
    };
  }

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  return { success: true };
}

export async function undoPaymentByAdmin(debtId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: "debtId không hợp lệ" };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: "Không tìm thấy công nợ" };

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sessionDebts)
        .set({
          memberConfirmed: false,
          memberConfirmedAt: null,
          adminConfirmed: false,
          adminConfirmedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessionDebts.id, debtId));

      const r = await recordFinancialTransaction(
        {
          type: "debt_undo",
          direction: "neutral",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Admin hoàn tác xác nhận thanh toán",
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Không hoàn tác được thanh toán",
    };
  }

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  return { success: true };
}

function getDateFilterStart(filter: string): string | null {
  const now = new Date();
  switch (filter) {
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    case "year":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    default:
      return null; // "all" - no filter
  }
}

export async function getDebtsForMember(
  memberId: number,
  filter: string = "all",
) {
  const [user, admin] = await Promise.all([
    getUserFromCookie(),
    getAdminFromCookie(),
  ]);
  if (!admin && user?.memberId !== memberId) return [];

  const dateStart = getDateFilterStart(filter);

  const debts = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.memberId, memberId),
    with: {
      session: true,
      member: true,
    },
    orderBy: [desc(sessionDebts.id)],
  });

  // Filter by session date if needed
  if (dateStart) {
    return debts.filter((d) => d.session.date >= dateStart);
  }
  return debts;
}

export async function getAllDebts(filter: string = "all") {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const dateStart = getDateFilterStart(filter);

  const debts = await db.query.sessionDebts.findMany({
    with: {
      session: true,
      member: true,
    },
    orderBy: [desc(sessionDebts.id)],
  });

  if (dateStart) {
    return debts.filter((d) => d.session.date >= dateStart);
  }
  return debts;
}

export type MemberFinanceRow = {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  isActive: boolean;
  totalOutstanding: number;
  totalPendingReview: number;
  totalPaid: number;
};

/** Tổng hợp công nợ theo từng thành viên (mọi member trong hệ thống, số 0 nếu không có khoản nợ). */
export async function getMemberFinanceOverview(): Promise<MemberFinanceRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const allMembers = await db.query.members.findMany({
    orderBy: [asc(members.name)],
  });
  const debts = await db.query.sessionDebts.findMany();

  const byId = new Map<
    number,
    { totalOutstanding: number; totalPendingReview: number; totalPaid: number }
  >();
  for (const m of allMembers) {
    byId.set(m.id, {
      totalOutstanding: 0,
      totalPendingReview: 0,
      totalPaid: 0,
    });
  }
  for (const debt of debts) {
    const agg = byId.get(debt.memberId);
    if (!agg) continue;
    if (debt.adminConfirmed) {
      agg.totalPaid += debt.totalAmount;
    } else if (debt.memberConfirmed) {
      agg.totalPendingReview += debt.totalAmount;
    } else {
      agg.totalOutstanding += debt.totalAmount;
    }
  }

  const rows: MemberFinanceRow[] = allMembers.map((m) => {
    const agg = byId.get(m.id)!;
    return {
      memberId: m.id,
      memberName: m.name,
      memberAvatarKey: m.avatarKey ?? null,
      memberAvatarUrl: m.avatarUrl ?? null,
      isActive: m.isActive ?? true,
      totalOutstanding: agg.totalOutstanding,
      totalPendingReview: agg.totalPendingReview,
      totalPaid: agg.totalPaid,
    };
  });

  return rows.sort((a, b) => {
    const sa = a.totalOutstanding + a.totalPendingReview;
    const sb = b.totalOutstanding + b.totalPendingReview;
    if (sb !== sa) return sb - sa;
    return a.memberName.localeCompare(b.memberName, undefined, {
      sensitivity: "base",
    });
  });
}

export async function getDebtSummary() {
  const rows = await getMemberFinanceOverview();
  return rows
    .filter((r) => r.totalOutstanding + r.totalPendingReview + r.totalPaid > 0)
    .map((r) => ({
      memberId: r.memberId,
      memberName: r.memberName,
      totalOutstanding: r.totalOutstanding,
      totalPendingReview: r.totalPendingReview,
      totalPaid: r.totalPaid,
    }));
}
