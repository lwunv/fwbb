"use server";

import { db } from "@/db";
import { PUBLIC_MEMBER_COLUMNS } from "@/lib/optimistic-votes";
import {
  sessions,
  sessionAttendees,
  sessionDebts,
  sessionMinDeductionExemptions,
  members,
  financialTransactions,
  admins,
} from "@/db/schema";
import { eq, desc, and, isNull, asc, inArray, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";
import { requireApprovedMember } from "@/lib/member-auth";
import {
  calculateSessionCosts,
  applyMinDeductionFloor,
  type AttendeeInput,
  type MemberDebt,
} from "@/lib/cost-calculator";
import {
  computeBalanceFromTransactions,
  computeBalancesForMembers,
} from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getAdminFromCookie, requireAdmin } from "@/lib/auth";
import { sendGroupMessage, buildDebtReminderMessage } from "@/lib/messenger";
import { finalizeSessionSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("serverErrors");
  if (!parsed.success) {
    return {
      error: t("invalidData", {
        detail: parsed.error.issues[0]?.message ?? "",
      }),
    };
  }
  const data = parsed.data;

  // 1. Load session with shuttlecocks
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    with: { shuttlecocks: true },
  });

  if (!session) return { error: t("sessionNotFound") };
  if (session.status === "cancelled")
    return { error: t("sessionCancelledCannotFinalize") };
  if (!session.courtPrice) return { error: t("courtPriceNotSet") };
  // Re-finalize a completed session (e.g., admin edited attendee list after
  // initial close) is intentionally allowed: the tx below reverses old
  // fund_deductions, nulls orphan debt-scoped ledger refs, deletes stale
  // attendees/debts, then re-creates everything from the new payload.

  // Resolve admin's member record outside the tx (read-only).
  // Multi-admin safe: pass current admin id từ cookie để mỗi admin map đúng
  // member của mình (trước đây findFirst() vô tình lấy admin #1 cho mọi
  // request → admin #2+ tự nợ chính mình khi finalize).
  const currentAdminId = parseInt(String(auth.admin.sub ?? ""), 10);
  const adminMemberId = await resolveAdminMemberId(currentAdminId);

  // Always require admin to be linked to a member record when finalizing —
  // otherwise the cost-distribution loop below treats admin's own row as a
  // regular member and creates a debt + fund_deduction for them, effectively
  // making admin "pay themselves". Failing fast here forces the admin to fix
  // the linkage first.
  if (adminMemberId === null) {
    return { error: t("adminNotLinkedToMember") };
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
        error: t("missingAdminGuestPlay", {
          expected: expectedAdminGuestPlay,
          actual: adminGuestPlayInPayload,
        }),
      };
    }
    if (adminGuestDineInPayload < expectedAdminGuestDine) {
      return {
        error: t("missingAdminGuestDine", {
          expected: expectedAdminGuestDine,
          actual: adminGuestDineInPayload,
        }),
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

  // Merged Quỹ + Nợ model: roster quỹ = members.isActive+approved (không còn
  // bảng fund_members để enrol). FULL session debt được trừ qua fund_deduction;
  // balance âm = "còn nợ" thống nhất.

  // Guard: member đã khóa/rời quỹ (isActive=false hoặc chưa approved) KHÔNG
  // được tính nợ — sẽ bị trừ quỹ (balance âm) trái với spec "khóa = đóng băng".
  // Bắt admin bỏ họ khỏi buổi trước khi chốt.
  const debtMemberIds = breakdown.memberDebts.map((d) => d.memberId);
  if (debtMemberIds.length > 0) {
    const rosterRows = await db.query.members.findMany({
      where: inArray(members.id, debtMemberIds),
      columns: { id: true, name: true, isActive: true, approvalStatus: true },
    });
    const lockedNames = rosterRows
      .filter((mb) => !mb.isActive || mb.approvalStatus !== "approved")
      .map((mb) => mb.name);
    if (lockedNames.length > 0) {
      return {
        error: `Thành viên đã khóa/rời quỹ không thể tính nợ: ${lockedNames.join(", ")}. Bỏ họ khỏi buổi rồi chốt lại.`,
      };
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
              // Per-original-deduction natural key — collapses crash-retry
              // double-inserts. The `alreadyReversed` check above guards the
              // current tx; this guards across tx replays.
              idempotencyKey: `finalize-reverse-${ftx.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }
      }

      // 2b. Reverse prior min-deduction penalty contributions (to admin). Bước
      // trên CHỈ reverse fund_deduction; penalty là fund_contribution
      // (memberId=adminMemberId) nên KHÔNG bị reverse → re-finalize sẽ
      // double-credit admin (vỡ I1). Match qua idempotencyKey prefix.
      const priorPenalties = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, data.sessionId),
          eq(financialTransactions.type, "fund_contribution"),
          isNull(financialTransactions.reversalOfId),
          like(financialTransactions.idempotencyKey, "min-deduction-penalty-%"),
        ),
      });
      for (const ptx of priorPenalties) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ptx.id),
        });
        if (!alreadyReversed) {
          const r = await recordFinancialTransaction(
            {
              type: "fund_refund",
              direction: "out",
              amount: ptx.amount,
              memberId: ptx.memberId,
              sessionId: ptx.sessionId,
              reversalOfId: ptx.id,
              description: `Hoàn lại phần dư min-60K khi chốt lại buổi ${session.date}`,
              idempotencyKey: `finalize-reverse-penalty-${ptx.id}`,
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

      // 3.6. Apply min-deduction floor (if session opt-in). MUST happen AFTER
      // reversing old fund_deductions above — balance phải reflect state
      // trước session này, không bị deduction cũ kéo xuống. Exempt list từ
      // `sessionMinDeductionExemptions` cho phép admin miễn từng member.
      // Skip admin's own debt (fundDeductionAmount luôn = 0 cho admin).
      // Spec: `docs/superpowers/specs/2026-05-15-min-deduction-floor-design.md`.
      let memberDebts: MemberDebt[] = breakdown.memberDebts;
      if (session.useMinDeduction) {
        const exemptIds = new Set(
          (
            await tx
              .select({
                memberId: sessionMinDeductionExemptions.memberId,
              })
              .from(sessionMinDeductionExemptions)
              .where(
                eq(sessionMinDeductionExemptions.sessionId, data.sessionId),
              )
          ).map((r) => r.memberId),
        );
        memberDebts = await Promise.all(
          breakdown.memberDebts.map(async (d) => {
            if (d.memberId === adminMemberId) return d; // admin không bị floor
            if (exemptIds.has(d.memberId)) return d; // admin miễn
            const memberTxs = await tx.query.financialTransactions.findMany({
              where: eq(financialTransactions.memberId, d.memberId),
            });
            const balance = computeBalanceFromTransactions(
              d.memberId,
              memberTxs,
            ).balance;
            return applyMinDeductionFloor(d, balance);
          }),
        );
      }

      // 4. For each attendee: deduct FULL debt amount from fund. The session
      // debt row is still recorded (audit) but immediately marked as confirmed
      // — the unified "còn nợ" lives on the fund balance, not on per-session
      // unpaid rows.
      for (const debt of memberDebts) {
        const isAdminDebt = debt.memberId === adminMemberId;
        // Admin trừ quỹ như member bình thường cho OWN play+dine.
        // Khách của admin (admin guests) KHÔNG tính vào debt admin — quỹ chung
        // gánh (hiển thị thành "lỗ" trên session card, đúng design: admin
        // dùng quỹ đãi khách). Khách CỦA admin với tư cách cá nhân (future)
        // sẽ là 1 attendee invitedBy=admin nhưng KHÔNG count trong
        // adminGuestPlayCount → tự động dùng nhánh else.
        const fundDeductionAmount = isAdminDebt
          ? debt.playAmount + debt.dineAmount
          : debt.totalAmount;

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

        // idempotencyKey chứa `insertedDebt.id` (sinh mới mỗi cycle), không
        // phải natural-key (sessionId, memberId). Lý do: reverse-then-reinsert
        // ở trên KHÔNG xóa các ledger row cũ — chỉ NULL `debtId` (line 198-201)
        // + reverse fund_deduction qua reversalOfId. Nếu dùng natural key
        // (sessionId, memberId), re-finalize sẽ UNIQUE-violate ngay với hàng
        // cũ còn lại. Tx serialization của SQLite (single-writer) là lá chắn
        // chống concurrent double-finalize; key này chủ yếu chặn replay nội
        // bộ trong 1 tx và làm audit trail dễ trace.
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
            idempotencyKey: `finalize-debt-${data.sessionId}-${debt.memberId}-${insertedDebt.id}`,
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
              idempotencyKey: `finalize-deduction-${data.sessionId}-${debt.memberId}-${insertedDebt.id}`,
            },
            tx,
          );
          if ("error" in r2) throw new Error(r2.error);
        }

        // Min-deduction penalty surplus → admin fund.
        // Khi floor fired (totalAmount sau > original), admin nhận phần dư để I1
        // hold (Σ fund_deduction = admin's real cash out). Member mất full floored
        // amount; admin gain surplus. Other members KHÔNG bị ảnh hưởng.
        // Spec: docs/superpowers/specs/2026-05-15-min-deduction-floor-design.md:29.
        if (session.useMinDeduction && adminMemberId !== null && !isAdminDebt) {
          const original = breakdown.memberDebts.find(
            (d) => d.memberId === debt.memberId,
          );
          const penalty =
            debt.totalAmount - (original?.totalAmount ?? debt.totalAmount);
          if (penalty > 0) {
            const r3 = await recordFinancialTransaction(
              {
                type: "fund_contribution",
                direction: "in",
                amount: penalty,
                memberId: adminMemberId,
                sessionId: data.sessionId,
                debtId: insertedDebt.id,
                description: `Phần dư min-60K buổi ${session.date} (member ${debt.memberId})`,
                idempotencyKey: `min-deduction-penalty-${data.sessionId}-${debt.memberId}-${insertedDebt.id}`,
              },
              tx,
            );
            if ("error" in r3) throw new Error(r3.error);
          }
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
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  revalidatePath("/my-debts");
  revalidatePath("/my-fund");
  return { success: true, breakdown };
}

/**
 * One-click finalize: build `attendeeList` từ vote data hiện tại + admin
 * guests, gọi `finalizeSession` trực tiếp. Không cần admin nhập attendee
 * thủ công qua wizard. Dùng khi admin click "Xác nhận buổi chơi" trên past
 * pending card.
 *
 * Quy ước build attendees:
 * - Mỗi member có willPlay/willDine → 1 attendee với cờ tương ứng.
 * - Mỗi guestPlayCount → 1 attendee guest (chỉ chơi).
 * - Mỗi guestDineCount → 1 attendee guest (chỉ nhậu).
 *   (Nếu khách thực tế vừa chơi vừa nhậu, admin phải finalize qua trang detail
 *   để input thủ công — auto-finalize đơn giản hóa, không suy ra split.)
 * - adminGuestPlay/Dine → guest invitedById = adminMemberId.
 *
 * Dùng `session.diningBill` đã set sẵn (admin nhập trên detail page hoặc 0).
 */
export async function finalizeSessionAuto(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: {
      votes: { with: { member: true } },
    },
  });
  const t = await getTranslations("serverErrors");
  if (!session) return { error: t("sessionNotFound") };
  if (session.status === "completed") {
    return { error: t("finalizeAlreadyCompleted") };
  }
  if (session.status === "cancelled") {
    return { error: t("finalizeAlreadyCancelled") };
  }

  const currentAdminId = parseInt(String(auth.admin.sub ?? ""), 10);
  const adminMemberId = await resolveAdminMemberId(currentAdminId);
  if (adminMemberId === null) {
    return { error: t("adminNotLinkedToMember") };
  }

  const attendeeList: FinalizeAttendee[] = [];
  for (const v of session.votes) {
    // Bỏ qua voter đã khóa / chưa duyệt (đã rời quỹ) — không tính nợ + không
    // tạo guest cho họ. Nếu không, guard trong finalizeSession sẽ abort TOÀN BỘ
    // one-click finalize khi có 1 voter bị khóa (dead-end, không có path gỡ).
    if (
      v.member &&
      (!v.member.isActive || v.member.approvalStatus !== "approved")
    ) {
      continue;
    }
    if (v.willPlay || v.willDine) {
      attendeeList.push({
        memberId: v.memberId,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: v.willPlay ?? false,
        attendsDine: v.willDine ?? false,
      });
    }
    const memberName = v.member?.name ?? `M${v.memberId}`;
    const gp = v.guestPlayCount ?? 0;
    const gd = v.guestDineCount ?? 0;
    for (let i = 0; i < gp; i++) {
      attendeeList.push({
        memberId: null,
        guestName: `Khách ${memberName} ${i + 1}`,
        invitedById: v.memberId,
        isGuest: true,
        attendsPlay: true,
        attendsDine: false,
      });
    }
    for (let i = 0; i < gd; i++) {
      attendeeList.push({
        memberId: null,
        guestName: `Khách ${memberName} (nhậu) ${i + 1}`,
        invitedById: v.memberId,
        isGuest: true,
        attendsPlay: false,
        attendsDine: true,
      });
    }
  }

  const adminGp = session.adminGuestPlayCount ?? 0;
  const adminGd = session.adminGuestDineCount ?? 0;
  for (let i = 0; i < adminGp; i++) {
    attendeeList.push({
      memberId: null,
      guestName: `Khách Admin ${i + 1}`,
      invitedById: adminMemberId,
      isGuest: true,
      attendsPlay: true,
      attendsDine: false,
    });
  }
  for (let i = 0; i < adminGd; i++) {
    attendeeList.push({
      memberId: null,
      guestName: `Khách Admin (nhậu) ${i + 1}`,
      invitedById: adminMemberId,
      isGuest: true,
      attendsPlay: false,
      attendsDine: true,
    });
  }

  return finalizeSession(sessionId, attendeeList, session.diningBill ?? 0);
}

/**
 * Resolve admin's member record. Prefers the explicit `admins.memberId` FK;
 * falls back to matching `admins.username === members.name` ONLY when exactly
 * one member matches (to avoid auto-confirming the wrong member's debt when
 * names collide).
 *
 * Multi-admin safe: takes the current admin's id (from JWT cookie) — trước
 * đây dùng `findFirst()` không filter → mọi action đều resolve về admin #1
 * regardless of who's logged in, khiến admin #2+ tự tạo nợ cho chính mình.
 */
async function resolveAdminMemberId(adminId: number): Promise<number | null> {
  if (!Number.isFinite(adminId) || adminId <= 0) return null;
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminId),
  });
  if (!admin) return null;
  if (admin.memberId != null) return admin.memberId;
  const matches = await db.query.members.findMany({
    where: eq(members.name, admin.username),
    columns: { id: true },
  });
  if (matches.length !== 1) return null;
  return matches[0].id;
}

/**
 * F1 fix helper — restore voided ledger rows for a debt that was previously
 * undone via `undoPaymentByAdmin`.
 *
 * Background: `undoPaymentByAdmin` reverses the original `fund_deduction`
 * (member's cost) AND any `fund_contribution` tied to the debt (admin's
 * min-deduction penalty surplus, bank-payment balance fix, etc.) by inserting
 * paired reversal rows. The original rows still exist but are "voided" — any
 * reversalOfId pointing at them excludes them from balance compute.
 *
 * When admin re-confirms after undo, `confirmPaymentBy{Admin,Member}` ONLY
 * flipped the `adminConfirmed`/`memberConfirmed` flags and wrote an audit row.
 * No fresh `fund_deduction` was inserted → member balance was NEVER
 * re-decremented → free session. This is the F1 money-loss bug.
 *
 * Fix: on re-confirm, detect that the debt has zero live fund_deduction rows
 * but does have voided ones (i.e. came back from an undo cycle), and re-insert
 * matching deductions + admin penalty contributions inside the same tx.
 *
 * Returns nothing — throws on error so the caller's tx rolls back.
 *
 * Idempotency: keyed on `${originalId}-${reason}` where reason is the cycle
 * count. Each undo→confirm cycle generates a new ledger pair, but the SAME
 * cycle is replay-safe.
 */
async function restoreVoidedLedgerForDebt(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  debtId: number,
  debt: { memberId: number; sessionId: number; totalAmount: number },
  sessionDate: string,
): Promise<void> {
  // 1. Member fund_deduction restoration.
  //    Are there any LIVE deductions for this debt? Live = original
  //    (reversalOfId IS NULL) that is NOT pointed at by any other row's
  //    reversalOfId. Use isNull(reversalOfId) to limit to originals first.
  const debtDeductions = await tx.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.debtId, debtId),
      eq(financialTransactions.type, "fund_deduction"),
      isNull(financialTransactions.reversalOfId),
    ),
  });

  let liveMemberDeductionExists = false;
  let cycleSeed = 0; // most-recent voided original id → makes idempotency key unique per cycle
  let restoreAmount = 0; // amount of THAT voided deduction — re-charge EXACTLY this
  for (const d of debtDeductions) {
    const reversal = await tx.query.financialTransactions.findFirst({
      where: eq(financialTransactions.reversalOfId, d.id),
      columns: { id: true },
    });
    if (!reversal) {
      liveMemberDeductionExists = true;
    } else if (d.id >= cycleSeed) {
      cycleSeed = d.id; // most-recent voided id seeds the key
      restoreAmount = d.amount; // ...và amount gốc của nó
    }
  }

  if (!liveMemberDeductionExists && restoreAmount > 0) {
    // No live deduction → debt was undone. Re-insert a fresh deduction so the
    // member is charged again. Dùng `restoreAmount` = amount của deduction GỐC
    // (đã bị void), KHÔNG phải debt.totalAmount — debt của admin gồm cả phần
    // khách (quỹ chung gánh) nên totalAmount > deduction thật (chỉ play+dine);
    // dùng total sẽ over-charge admin. cycleSeed làm key unique mỗi cycle.
    const r = await recordFinancialTransaction(
      {
        type: "fund_deduction",
        direction: "out",
        amount: restoreAmount,
        memberId: debt.memberId,
        sessionId: debt.sessionId,
        debtId,
        description: `Trừ quỹ buổi ${sessionDate} (re-confirm sau undo)`,
        idempotencyKey: `re-confirm-deduction-${debtId}-${cycleSeed}`,
      },
      tx,
    );
    if ("error" in r) throw new Error(r.error);
  }

  // 2. Admin min-deduction penalty restoration.
  //    Admin penalty contributions are tagged with debtId=insertedDebt.id and
  //    type=fund_contribution. After undo, the row exists but is voided by a
  //    `fund_refund` (with reversalOfId pointing at it). If we find such a
  //    voided contribution whose memberId differs from debt.memberId (i.e.
  //    belongs to admin, not the debt owner), re-insert it so admin's penalty
  //    surplus is restored.
  const debtContribs = await tx.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.debtId, debtId),
      eq(financialTransactions.type, "fund_contribution"),
      isNull(financialTransactions.reversalOfId),
    ),
  });

  for (const c of debtContribs) {
    if (c.memberId === debt.memberId) continue; // not a penalty row (skip bank balance-fix etc. tied to member themselves)
    if (c.memberId === null) continue;
    const reversal = await tx.query.financialTransactions.findFirst({
      where: eq(financialTransactions.reversalOfId, c.id),
      columns: { id: true },
    });
    if (!reversal) continue; // still live, no need to restore

    // idempotencyKey `re-confirm-penalty-${c.id}` is unique per voided
    // original — recordFinancialTransaction's idempotent path returns the
    // existing row id on replay, so re-running this confirm-then-undo-then-
    // confirm cycle won't duplicate the penalty. Each fresh undo→confirm
    // cycle voids a NEW row (the previously-restored one) → new c.id → new
    // key, so the next restore is allowed.
    const r = await recordFinancialTransaction(
      {
        type: "fund_contribution",
        direction: "in",
        amount: c.amount,
        memberId: c.memberId,
        sessionId: c.sessionId,
        debtId,
        description: `Khôi phục phụ phí buổi ${sessionDate} (re-confirm sau undo)`,
        idempotencyKey: `re-confirm-penalty-${c.id}`,
      },
      tx,
    );
    if ("error" in r) throw new Error(r.error);
  }
}

export async function confirmPaymentByMember(
  debtId: number,
  idempotencyKey: string,
) {
  const t = await getTranslations("serverErrors");
  const memberAuth = await requireApprovedMember();
  if ("error" in memberAuth) return { error: memberAuth.error };
  const user = memberAuth.user;

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: t("invalidDebtId") };
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 4) {
    return { error: t("invalidIdempotencyKey") };
  }

  // 30 confirm-payment attempts per member per minute (prevents ledger-spam
  // via repeated re-confirms even if the idempotent guard short-circuits).
  const rl = await checkRateLimit(
    `confirm-payment:${user.memberId}`,
    30,
    60_000,
  );
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
    with: { session: true },
  });
  if (!debt) return { error: t("debtNotFound") };
  if (debt.memberId !== user.memberId) {
    return { error: t("cannotConfirmForOthers") };
  }
  // Idempotent: re-confirm is no-op (prevents ledger spam by spamming the button).
  if (debt.memberConfirmed) return { success: true };
  if (debt.session.status === "cancelled") {
    return { error: t("sessionAlreadyCancelled") };
  }
  if (debt.session.status !== "completed") {
    return { error: t("onlyConfirmAfterFinalize") };
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

      // F1: if this debt was previously undone, restore the voided
      // fund_deduction (and any admin penalty contribution).
      await restoreVoidedLedgerForDebt(
        tx,
        debtId,
        {
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          totalAmount: debt.totalAmount,
        },
        debt.session.date,
      );

      const r = await recordFinancialTransaction(
        {
          type: "debt_member_confirmed",
          direction: "neutral",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Thành viên xác nhận đã chuyển khoản",
          // Caller-supplied UUID — fresh per click. The early-return
          // `debt.memberConfirmed` guard above suppresses no-op rewrites, but
          // legitimate re-confirms after undo cycles need a fresh ledger row,
          // which a server-hard-coded key (the old behaviour) would block.
          idempotencyKey: `debt-member-confirm-${debtId}-${idempotencyKey}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : t("paymentConfirmFailed"),
    };
  }

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/history");
  revalidatePath("/");
  return { success: true };
}

export async function confirmPaymentByAdmin(
  debtId: number,
  idempotencyKey: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: t("invalidDebtId") };
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 4) {
    return { error: t("invalidIdempotencyKey") };
  }

  // Same per-admin rate limit shape as member-side — compromised admin cookie
  // could otherwise ledger-spam re-confirms across many debts.
  const adminId = String(auth.admin.sub ?? "anon");
  const rl = await checkRateLimit(
    `confirm-payment-admin:${adminId}`,
    60,
    60_000,
  );
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
    with: { session: true },
  });
  if (!debt) return { error: t("debtNotFound") };
  if (debt.adminConfirmed) return { success: true };
  // Mirror the member-side guard: never re-insert a ledger row on a session
  // that was cancelled or deleted (its fund_deductions are already reversed,
  // and restoreVoidedLedgerForDebt below would re-credit the deduction →
  // member silently pays for a session that no longer exists).
  if (debt.session.status === "cancelled") {
    return { error: t("sessionAlreadyCancelled") };
  }
  if (debt.session.status !== "completed") {
    return { error: t("onlyConfirmAfterFinalize") };
  }

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

      // F1: if this debt was previously undone, restore the voided
      // fund_deduction (and any admin penalty contribution) so balance is
      // actually decremented again. Without this, the undo→re-confirm cycle
      // leaves the member un-deducted (free session).
      await restoreVoidedLedgerForDebt(
        tx,
        debtId,
        {
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          totalAmount: debt.totalAmount,
        },
        debt.session.date,
      );

      const r = await recordFinancialTransaction(
        {
          type: "debt_admin_confirmed",
          direction: "neutral",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Admin xác nhận đã nhận tiền",
          idempotencyKey: `debt-admin-confirm-${debtId}-${idempotencyKey}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : t("paymentConfirmFailed"),
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
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(debtId) || debtId <= 0) {
    return { error: t("invalidDebtId") };
  }

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: t("debtNotFound") };

  try {
    await db.transaction(async (tx) => {
      // BLOCKER fix: trong merged Quỹ+Nợ model, finalize đã ghi
      // `fund_deduction` cho debt này. Trước đây undo CHỈ flip flags + ghi
      // `debt_undo` neutral → ledger vẫn giữ deduction → autoApplyFundToDebts
      // chạy lần sau lại deduct LẦN 2 (member mất tiền 2 lần).
      // Fix: tìm tất cả fund_deduction gốc (chưa bị reversal) cho debt này,
      // insert fund_contribution đối ứng với reversalOfId trỏ về row gốc →
      // balance member hoàn lại đúng amount đã trừ. Skip rows đã có reversal
      // để idempotent.
      //
      // Tại sao findMany thay vì findFirst: sau cycle undo→re-confirm (F1
      // fix), một debt có thể có NHIỀU original fund_deduction rows — row cũ
      // (đã voided) + row mới do F1 helper re-insert. findFirst() trước đây
      // có thể trúng row cũ → skip "đã reversed" → bỏ sót row mới → member
      // vĩnh viễn bị trừ tiền sau lần undo thứ 2.
      const originalDeductions = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.type, "fund_deduction"),
          eq(financialTransactions.debtId, debtId),
          isNull(financialTransactions.reversalOfId),
        ),
      });

      // Track the most recent live deduction id for the audit key suffix
      // (keeps each cycle's debt_undo row distinct).
      let lastLiveDeductionId: number | null = null;

      for (const originalDeduction of originalDeductions) {
        // Đã có sẵn reversal cho deduction này chưa? (idempotent guard)
        const existingReversal = await tx.query.financialTransactions.findFirst(
          {
            where: eq(financialTransactions.reversalOfId, originalDeduction.id),
            columns: { id: true },
          },
        );
        if (existingReversal) continue;

        lastLiveDeductionId = originalDeduction.id;

        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: originalDeduction.amount,
            // CRITICAL: use the ORIGINAL row's memberId, not debt.memberId.
            // Currently they're the same (finalize ghi fund_deduction với
            // memberId = debt.memberId), but pinning to `originalDeduction
            // .memberId` is safer and consistent với cách reverse contribs
            // bên dưới (mỗi reversal phải đối ứng đúng owner để per-member
            // balance compute void được).
            memberId: originalDeduction.memberId,
            sessionId: debt.sessionId,
            debtId,
            reversalOfId: originalDeduction.id,
            description: "Hoàn tác trừ quỹ — admin undo thanh toán",
            metadata: { source: "debt_undo_reversal" },
            idempotencyKey: `debt-undo-reverse-${originalDeduction.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      // CRITICAL FIX: nếu debt được trả qua bank webhook, payment-matcher đã
      // insert 1 `fund_contribution` "balance fix" (idempotencyKey
      // `bank-payment-balance-${debtId}`) để cân bằng deduction → balance
      // member = 0 sau khi trả. Trước đây undo CHỈ reverse deduction →
      // balance bị +totalAmount excess (member được tặng tiền miễn phí).
      // Fix: tìm tất cả fund_contribution chưa reverse có debtId này (ngoại
      // trừ row reversal ta vừa insert ở trên) và reverse nốt. Cover cả
      // bank balance-fix lẫn case admin tự confirm payment khi member nói
      // "đã trả qua quỹ" — symmetric.
      const linkedContributions = await tx.query.financialTransactions.findMany(
        {
          where: and(
            eq(financialTransactions.type, "fund_contribution"),
            eq(financialTransactions.debtId, debtId),
            isNull(financialTransactions.reversalOfId),
          ),
        },
      );
      for (const contrib of linkedContributions) {
        // Skip row reversal-from-deduction ta vừa tạo (nó cũng có debtId=debtId
        // và type=fund_contribution nhưng có reversalOfId set → query đã
        // filter `isNull(reversalOfId)` nên không lọt; defense in depth).
        if (contrib.reversalOfId !== null) continue;
        // Đã reverse rồi? skip (idempotent)
        const already = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, contrib.id),
          columns: { id: true },
        });
        if (already) continue;

        const rr = await recordFinancialTransaction(
          {
            type: "fund_refund",
            direction: "out",
            amount: contrib.amount,
            // CRITICAL: use the ORIGINAL contribution's memberId, NOT
            // debt.memberId. Admin min-deduction penalty contributions are
            // memberId=adminMemberId (≠ debt.memberId). Setting reversal's
            // memberId=debt.memberId leaves admin's per-member balance
            // compute unable to void the contribution (because the reversal
            // is in a different member's bucket), violating I1 (Σ over all
            // members ≠ admin's cash out). Pinning to contrib.memberId fixes
            // this and is correct for all cases (bank balance-fix is also
            // memberId=member, same as debt.memberId).
            memberId: contrib.memberId,
            sessionId: debt.sessionId,
            debtId,
            reversalOfId: contrib.id,
            description: `Hoàn tác cân bằng quỹ — admin undo thanh toán nợ #${debtId}`,
            metadata: { source: "debt_undo_balance_fix_reversal" },
            idempotencyKey: `debt-undo-balance-fix-${contrib.id}`,
          },
          tx,
        );
        if ("error" in rr) throw new Error(rr.error);
      }

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

      // Audit row (neutral) — vẫn giữ để có dấu vết undo trong ledger.
      // Idempotency key gắn với the most recently reversed deduction id (mỗi
      // cycle confirm→undo có 1 deduction unique). Trước đây dùng Date.now()
      // → 2 click nhanh tạo 2 audit row trùng. Khi admin re-confirm →
      // finalize/F1 helper tạo deduction mới có id khác → key mới → undo lần
      // 2 vẫn ghi audit được.
      const r = await recordFinancialTransaction(
        {
          type: "debt_undo",
          direction: "neutral",
          amount: debt.totalAmount,
          memberId: debt.memberId,
          sessionId: debt.sessionId,
          debtId,
          description: "Admin hoàn tác xác nhận thanh toán",
          idempotencyKey: `debt-undo-audit-${debtId}-${
            lastLiveDeductionId ?? "no-deduction"
          }`,
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
      // Whitelist safe columns — never ship the member's own passwordHash/PII
      // back to their browser (defense-in-depth even though owner-gated).
      member: { columns: PUBLIC_MEMBER_COLUMNS },
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
      // Whitelist safe columns — admin UI never needs members' passwordHash/PII
      // client-side (defense-in-depth even though admin-gated).
      member: { columns: PUBLIC_MEMBER_COLUMNS },
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

  // Merged Quỹ+Nợ: "còn nợ"/"còn quỹ" = balance từ LEDGER (single source).
  // KHÔNG suy từ cờ memberConfirmed/adminConfirmed — trong model gộp, 2 cờ này
  // chỉ còn nghĩa "đã ghi ledger" (finalize/auto/bank set =true ngay) nên bucket
  // theo cờ sẽ đẩy mọi nợ vào "đã trả" → totalOutstanding sai (≈0).
  const memberIds = allMembers.map((m) => m.id);
  const allTxs =
    memberIds.length > 0
      ? await db.query.financialTransactions.findMany({
          where: inArray(financialTransactions.memberId, memberIds),
          columns: {
            memberId: true,
            type: true,
            amount: true,
            id: true,
            reversalOfId: true,
          },
        })
      : [];
  const balances = computeBalancesForMembers(
    memberIds,
    allTxs.map((t) => ({
      memberId: t.memberId!,
      type: t.type,
      amount: t.amount,
      id: t.id,
      reversalOfId: t.reversalOfId,
    })),
  );

  const rows: MemberFinanceRow[] = allMembers.map((m) => {
    const bal = balances[m.id] ?? 0;
    return {
      memberId: m.id,
      memberName: m.name,
      memberAvatarKey: m.avatarKey ?? null,
      memberAvatarUrl: m.avatarUrl ?? null,
      isActive: m.isActive ?? true,
      totalOutstanding: bal < 0 ? -bal : 0,
      totalPendingReview: 0,
      totalPaid: bal > 0 ? bal : 0,
    };
  });

  return rows.sort((a, b) => {
    if (b.totalOutstanding !== a.totalOutstanding)
      return b.totalOutstanding - a.totalOutstanding;
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
