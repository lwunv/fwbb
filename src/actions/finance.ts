"use server";

import { db } from "@/db";
import {
  sessions,
  sessionAttendees,
  sessionDebts,
  members,
  financialTransactions,
} from "@/db/schema";
import { eq, desc, and, isNull, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";
import {
  calculateSessionCosts,
  type AttendeeInput,
} from "@/lib/cost-calculator";
import {
  getFundBalance,
  isFundMember,
  calculateFundDeduction,
} from "@/lib/fund-calculator";
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
  if (session.status === "completed")
    return { error: "Buoi choi da hoan thanh" };
  if (!session.courtPrice) return { error: "Chua thiet lap gia san" };

  // Resolve admin's member record outside the tx (read-only).
  // Hardened: only auto-confirm if exactly ONE member matches the admin username,
  // to avoid confirming wrong member's debt when names collide.
  const adminMemberId = await resolveAdminMemberId();

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

  // Pre-resolve fund eligibility and balances per member (read-only) so the
  // transaction body stays focused on writes.
  const fundContext = new Map<number, { inFund: boolean; balance: number }>();
  for (const debt of breakdown.memberDebts) {
    const inFund = await isFundMember(debt.memberId);
    let balance = 0;
    if (inFund) {
      const r = await getFundBalance(debt.memberId);
      balance = r.balance;
    }
    fundContext.set(debt.memberId, { inFund, balance });
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

      // Wipe stale attendees + debts for clean re-finalize
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

      // 4. Insert debt + ledger entries per member
      for (const debt of breakdown.memberDebts) {
        const isAdminDebt = debt.memberId === adminMemberId;
        const ctx = fundContext.get(debt.memberId)!;

        let debtTotalAmount = debt.totalAmount;
        let paidByFund = false;
        let fundDeductionAmount = 0;

        if (ctx.inFund && !isAdminDebt) {
          const deduction = calculateFundDeduction(
            ctx.balance,
            debt.totalAmount,
          );
          if (deduction.deductedFromFund > 0) {
            fundDeductionAmount = deduction.deductedFromFund;
            debtTotalAmount = deduction.remainingDebt;
            paidByFund = deduction.fullyPaidByFund;
          }
        }

        const [insertedDebt] = await tx
          .insert(sessionDebts)
          .values({
            sessionId: data.sessionId,
            memberId: debt.memberId,
            playAmount: debt.playAmount,
            dineAmount: debt.dineAmount,
            guestPlayAmount: debt.guestPlayAmount,
            guestDineAmount: debt.guestDineAmount,
            totalAmount: debtTotalAmount,
            memberConfirmed: isAdminDebt || paidByFund,
            memberConfirmedAt: isAdminDebt || paidByFund ? now : null,
            adminConfirmed: isAdminDebt || paidByFund,
            adminConfirmedAt: isAdminDebt || paidByFund ? now : null,
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
              remainingDebt: debtTotalAmount,
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
  const rl = checkRateLimit(`confirm-payment:${user.memberId}`, 30, 60_000);
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
