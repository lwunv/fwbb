"use server";

import { db } from "@/db";
import { financialTransactions, fundMembers, members } from "@/db/schema";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getFundBalance, getAllFundBalances } from "@/lib/fund-calculator";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { requireAdmin, getAdminFromCookie } from "@/lib/auth";
import { getUserFromCookie } from "@/lib/user-identity";
import { formatVND } from "@/lib/utils";
import { fundContributionSchema, fundRefundSchema } from "@/lib/validators";
import { getTranslations } from "next-intl/server";

type FundTransactionType =
  | "fund_contribution"
  | "fund_deduction"
  | "fund_refund";
const FUND_TRANSACTION_TYPES: FundTransactionType[] = [
  "fund_contribution",
  "fund_deduction",
  "fund_refund",
];

// ─── Fund Member Management ───

export async function addFundMember(memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  // Check if member exists
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) return { error: t("memberNotFound") };

  // Check if already a fund member
  const existing = await db.query.fundMembers.findFirst({
    where: eq(fundMembers.memberId, memberId),
  });

  if (existing) {
    if (existing.isActive) return { error: t("memberAlreadyInFund") };

    // Re-activate
    await db
      .update(fundMembers)
      .set({ isActive: true, leftAt: null, joinedAt: new Date().toISOString() })
      .where(eq(fundMembers.id, existing.id));
  } else {
    await db.insert(fundMembers).values({ memberId });
  }

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

export async function removeFundMember(
  memberId: number,
  refundBalance: boolean = true,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: t("memberNotInFund") };

  // If refunding, check balance and create refund transaction. The whole
  // sequence (read balance → insert refund → flip isActive=false) runs in
  // a single transaction so two admins clicking "Remove + refund" at the
  // same time can't double-refund: the second tx sees `isActive=false` and
  // bails out, OR (if both sneak past the isActive check) the
  // idempotency key on `fundMembers.id` collapses both refunds into one.
  // Atomic: refund (nếu có) + flip isActive=false trong CÙNG transaction.
  // Trước đây refund inside tx, isActive flip outside → contribution arriving
  // giữa 2 query có thể leave member với positive balance + isActive=false.
  try {
    await db.transaction(async (tx) => {
      if (refundBalance) {
        const txs = await tx.query.financialTransactions.findMany({
          where: eq(financialTransactions.memberId, memberId),
        });
        let bal = 0;
        for (const t of txs) {
          if (t.type === "fund_contribution") bal += t.amount;
          else if (t.type === "fund_deduction") bal -= t.amount;
          else if (t.type === "fund_refund") bal -= t.amount;
        }
        if (bal > 0) {
          const r = await recordFinancialTransaction(
            {
              memberId,
              type: "fund_refund",
              direction: "out",
              amount: bal,
              description: "Hoàn quỹ khi rời nhóm",
              // Natural key — `fundMembers.id` is monotonic and never
              // recycled, so this guards against double-click /
              // multi-admin races without needing a client UUID.
              idempotencyKey: `leave-fund-refund-${fm.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }
      }

      await tx
        .update(fundMembers)
        .set({ isActive: false, leftAt: new Date().toISOString() })
        .where(eq(fundMembers.id, fm.id));
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không rời được khỏi quỹ",
    };
  }

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return { success: true };
}

// ─── Fund Contributions ───

/**
 * Admin records that a member has paid into the fund. Strict validation:
 *  - Zod-bounded amount (1k ≤ amount ≤ 100M, integer VND).
 *  - Required idempotencyKey — without it a double-submit would insert two
 *    rows. The DB UNIQUE INDEX on idempotency_key catches concurrent races.
 */
export async function recordContribution(
  memberId: number,
  amount: number,
  description?: string,
  idempotencyKey?: string,
): Promise<{ success: true; replayed: boolean } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const t = await getTranslations("serverErrors");

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 4
  ) {
    return { error: t("missingIdempotencyKey") };
  }

  const parsed = fundContributionSchema.safeParse({
    memberId,
    amount,
    description,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }

  // Auto-enrol + record trong CÙNG transaction. Trước đây upsert ngoài tx
  // có thể race khi 2 admin cùng đóng quỹ cho 1 member chưa enroll → DB
  // UNIQUE (fundMembers.memberId) ném exception thứ 2 không catch được.
  const member = await db.query.members.findFirst({
    where: eq(members.id, parsed.data.memberId),
    columns: { id: true },
  });
  if (!member) return { error: t("memberNotFound") };

  let replayed = false;
  try {
    await db.transaction(async (tx) => {
      // onConflictDoUpdate — atomic upsert, không race vs concurrent insert.
      await tx
        .insert(fundMembers)
        .values({ memberId: parsed.data.memberId })
        .onConflictDoUpdate({
          target: fundMembers.memberId,
          set: {
            isActive: true,
            leftAt: null,
            joinedAt: new Date().toISOString(),
          },
        });

      const r = await recordFinancialTransaction(
        {
          memberId: parsed.data.memberId,
          type: "fund_contribution",
          direction: "in",
          amount: parsed.data.amount,
          description: parsed.data.description || "Đóng quỹ",
          idempotencyKey,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      replayed = r.replayed === true;
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không ghi được giao dịch",
    };
  }

  // Auto-settle outstanding session debts with the new balance.
  const { autoApplyFundToDebts } = await import("./auto-fund");
  await autoApplyFundToDebts(parsed.data.memberId);

  revalidatePath("/admin/fund");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
  return { success: true, replayed };
}

/**
 * Admin records a refund out of a member's fund balance.
 *
 * Race-safety: balance is read & written inside a single `db.transaction`.
 * Two admins clicking "hoàn quỹ" with amount=balance no longer both pass
 * the check — the second sees the new (lower) balance and fails. Required
 * idempotencyKey + DB UNIQUE on it makes the same submit idempotent.
 */
export async function recordRefund(
  memberId: number,
  amount: number,
  description?: string,
  idempotencyKey?: string,
): Promise<{ success: true; replayed: boolean } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 4
  ) {
    return { error: "Thiếu idempotencyKey" };
  }

  const parsed = fundRefundSchema.safeParse({
    memberId,
    amount,
    description,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  let inserted: { id: number; replayed?: boolean } | null = null;
  try {
    await db.transaction(async (tx) => {
      // Re-check balance INSIDE the tx so concurrent refunds can't both pass
      // a stale balance check. SQLite serializes writers, so the second tx
      // sees the first's effects.
      const txs = await tx.query.financialTransactions.findMany({
        where: eq(financialTransactions.memberId, parsed.data.memberId),
      });
      let bal = 0;
      for (const t of txs) {
        if (t.type === "fund_contribution") bal += t.amount;
        else if (t.type === "fund_deduction") bal -= t.amount;
        else if (t.type === "fund_refund") bal -= t.amount;
      }
      if (parsed.data.amount > bal) {
        throw new Error(`Số dư không đủ (hiện có: ${formatVND(bal)})`);
      }

      const r = await recordFinancialTransaction(
        {
          memberId: parsed.data.memberId,
          type: "fund_refund",
          direction: "out",
          amount: parsed.data.amount,
          description: parsed.data.description || "Hoàn quỹ",
          idempotencyKey,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      inserted = { id: r.id, replayed: r.replayed };
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không hoàn được quỹ",
    };
  }

  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
  return {
    success: true as const,
    replayed: (inserted as { replayed?: boolean } | null)?.replayed === true,
  };
}

// ─── Queries ───
//
// SECURITY: every query that exposes PII (bank account, fb id, full names) or
// other members' financial activity is gated. Without `requireAdmin`, any
// signed-in member could call these via devtools and leak the whole group's
// fund history.

export async function getFundMembers() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  return db.query.fundMembers.findMany({
    with: { member: true },
    orderBy: [desc(fundMembers.joinedAt)],
  });
}

export async function getFundMembersWithBalances() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const fms = await db.query.fundMembers.findMany({
    where: eq(fundMembers.isActive, true),
    with: { member: true },
  });

  const result = [];
  for (const fm of fms) {
    const balance = await getFundBalance(fm.memberId);
    result.push({ ...fm, balance });
  }

  return result.sort((a, b) => b.balance.balance - a.balance.balance);
}

/**
 * Per-member transaction list. Only the member themselves OR an admin can see
 * it — anyone else (including other authenticated members) gets [] to prevent
 * IDOR-style leakage of fund history across members.
 */
export async function getFundTransactionsForMember(memberId: number) {
  const [admin, user] = await Promise.all([
    getAdminFromCookie(),
    getUserFromCookie(),
  ]);
  const isOwner = user?.memberId === memberId;
  const isAdmin = admin?.role === "admin";
  if (!isOwner && !isAdmin) return [];

  const rows = await db.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.memberId, memberId),
      inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    ),
    with: { session: true },
    orderBy: [desc(financialTransactions.createdAt)],
  });

  return rows.map((tx) => ({ ...tx, type: tx.type as FundTransactionType }));
}

export async function getAllFundTransactions() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    with: { member: true, session: true },
    orderBy: [desc(financialTransactions.createdAt)],
  });

  return rows
    .filter((tx) => tx.memberId !== null && tx.member !== null)
    .map((tx) => ({
      ...tx,
      memberId: tx.memberId as number,
      type: tx.type as FundTransactionType,
      member: tx.member!,
    }));
}

/**
 * Fetch the most recent financial transactions across ALL types (fund flows,
 * court rent, inventory purchases, debt events, manual adjustments). Used by
 * the admin transaction log on /admin/finance.
 *
 * Each row is annotated with:
 *  - `isReversal`: this row IS a reversal of another (reversalOfId !== null).
 *  - `isReversed`: another row reverses THIS one — appears in `voidedBy` set.
 *
 * Admins use these flags to gray out reversed rows, hide the "Hủy" button on
 * already-reversed rows, and label reversal entries clearly in the log.
 */
export async function getRecentFinancialTransactions(limit = 100) {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  // Two queries: 1) the window of recent rows, 2) ALL reversal pointers in
  // the entire ledger (only `reversalOfId` column — cheap). We need the global
  // view because a reversal entry might be outside the window while its
  // original IS in it; without the global query, the original would falsely
  // show as "not reversed" → admin sees the X button and can attempt re-void.
  // Server idempotent guards catch the re-void at action time, but UI lying
  // is bad UX.
  const [rows, allReversalPointers] = await Promise.all([
    db.query.financialTransactions.findMany({
      with: { member: true, session: true },
      orderBy: [desc(financialTransactions.createdAt)],
      limit,
    }),
    db.query.financialTransactions.findMany({
      where: isNotNull(financialTransactions.reversalOfId),
      columns: { reversalOfId: true },
    }),
  ]);

  const reversedIds = new Set<number>();
  for (const r of allReversalPointers) {
    if (r.reversalOfId !== null) reversedIds.add(r.reversalOfId);
  }

  return rows.map((r) => ({
    ...r,
    isReversal: r.reversalOfId !== null,
    isReversed: reversedIds.has(r.id),
  }));
}

/**
 * Reverse a financial transaction (fintech-compliant void).
 *
 * KHÔNG hard-delete — chuẩn audit trail của ledger fintech là giữ nguyên row
 * gốc + insert 1 counter-entry với `reversalOfId` trỏ về nó. Balance member
 * tự cân bằng vì compute sum theo type/amount → +X rồi −X = 0.
 *
 * Cho phép reverse:
 *   - `fund_contribution` (admin nhập sai số / nhầm member) → reversal
 *     `fund_refund` cùng amount, `reversalOfId` = id gốc.
 *   - `fund_refund` → reversal `fund_contribution` cùng amount.
 *
 * Không cho phép reverse:
 *   - `fund_deduction` (allocation từ finalizeSession — cancel qua delete
 *     session/finalize-undo).
 *   - `debt_*` (lifecycle riêng qua action sessions).
 *   - `inventory_purchase`, `court_rent_payment` (đã có flow delete riêng
 *     reverse stock/lịch sử riêng).
 *   - row đã là reversal (reversalOfId !== null).
 *   - row đã bị reversed bởi entry khác (idempotent).
 *
 * idempotencyKey BẮT BUỘC để client double-click không insert đôi.
 */
export async function reverseFinancialTransaction(
  txId: number,
  idempotencyKey: string,
  reason?: string,
): Promise<{ success: true; replayed: boolean } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const t = await getTranslations("serverErrors");

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 4
  ) {
    return { error: t("missingIdempotencyKey") };
  }

  const original = await db.query.financialTransactions.findFirst({
    where: eq(financialTransactions.id, txId),
  });
  if (!original) return { error: t("transactionNotFound") };

  if (original.reversalOfId !== null) {
    return { error: t("reversalCannotUndo") };
  }

  const reversibleTypes = new Set(["fund_contribution", "fund_refund"]);
  if (!reversibleTypes.has(original.type)) {
    return {
      error:
        "Loại giao dịch này không hỗ trợ hủy. Chỉ cho phép hủy đóng quỹ / hoàn quỹ thủ công.",
    };
  }

  // Đã có row reverse trỏ về tx này? → idempotent: return success replayed.
  const existingReversal = await db.query.financialTransactions.findFirst({
    where: eq(financialTransactions.reversalOfId, txId),
    columns: { id: true },
  });
  if (existingReversal) {
    return { success: true, replayed: true };
  }

  const reverseType =
    original.type === "fund_contribution" ? "fund_refund" : "fund_contribution";
  const reverseDirection = original.direction === "in" ? "out" : "in";
  const baseDesc = original.description ?? "";
  const reasonSuffix = reason?.trim() ? ` (${reason.trim()})` : "";
  const desc = `Hủy: ${baseDesc}${reasonSuffix}`.slice(0, 500);

  let replayed = false;
  try {
    await db.transaction(async (tx) => {
      // Re-check inside tx — phòng race khi 2 admin cùng bấm Hủy: SQLite
      // serialize writers, người thứ 2 sẽ thấy reversal entry đã insert.
      const recheck = await tx.query.financialTransactions.findFirst({
        where: eq(financialTransactions.reversalOfId, txId),
        columns: { id: true },
      });
      if (recheck) {
        replayed = true;
        return;
      }

      // SAFETY GUARD: nếu reverse 1 fund_contribution mà sau đó
      // autoApplyFundToDebts đã trừ tiền cho debt → balance hiện tại có thể
      // < amount. Reverse sẽ kéo balance < 0 nhưng debt đã marked paid →
      // invariant I8 broken (debt nói "đã trả thật" nhưng quỹ âm).
      // Reject với hướng dẫn rõ: admin phải dùng deleteSession hoặc
      // undoPaymentByAdmin trước.
      if (original.type === "fund_contribution" && original.memberId !== null) {
        const memberTxs = await tx.query.financialTransactions.findMany({
          where: eq(financialTransactions.memberId, original.memberId),
        });
        const balance = computeBalanceFromTransactions(
          original.memberId,
          memberTxs,
        ).balance;
        if (balance < original.amount) {
          throw new Error(
            `Không thể hủy: số dư hiện tại (${formatVND(
              balance,
            )}) thấp hơn amount cần trả lại (${formatVND(
              original.amount,
            )}). Có thể tiền đã được tự động trừ vào nợ buổi nào đó. Vui lòng undo payment cho debt liên quan trước, hoặc xóa session đó.`,
          );
        }
      }

      const r = await recordFinancialTransaction(
        {
          memberId: original.memberId,
          type: reverseType,
          direction: reverseDirection,
          amount: original.amount,
          description: desc,
          reversalOfId: original.id,
          idempotencyKey,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      replayed = r.replayed === true;
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không hủy được giao dịch",
    };
  }

  // Auto-apply remaining balance to outstanding debts — nếu reverse 1
  // contribution khiến balance tụt xuống nhưng vẫn > 0, không cần thêm logic.
  // Nhưng nếu reverse 1 refund → balance tăng → có thể auto-apply vào debt.
  if (original.memberId !== null && original.type === "fund_refund") {
    const { autoApplyFundToDebts } = await import("./auto-fund");
    await autoApplyFundToDebts(original.memberId);
  }

  revalidatePath("/admin/fund");
  revalidatePath("/admin/fund/transactions");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
  return { success: true, replayed };
}

export async function getFundOverview() {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      totalBalance: 0,
      totalContributions: 0,
      totalDeductions: 0,
      totalRefunds: 0,
      memberCount: 0,
      balances: [],
      cashOnHand: 0,
      totalGroupExpenses: 0,
      groupExpenseCourtRent: 0,
      groupExpenseInventory: 0,
    };
  }

  const [balances, groupTxs] = await Promise.all([
    getAllFundBalances(),
    db.query.financialTransactions.findMany({
      where: inArray(financialTransactions.type, [
        "court_rent_payment",
        "inventory_purchase",
      ]),
      columns: {
        id: true,
        type: true,
        direction: true,
        amount: true,
        reversalOfId: true,
      },
    }),
  ]);
  const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
  const totalContributions = balances.reduce(
    (sum, b) => sum + b.totalContributions,
    0,
  );
  const totalDeductions = balances.reduce(
    (sum, b) => sum + b.totalDeductions,
    0,
  );
  const totalRefunds = balances.reduce((sum, b) => sum + b.totalRefunds, 0);
  const memberCount = balances.length;

  // Group expenses (memberId-agnostic real cash out): bỏ cặp original+reversal
  // ra khỏi tổng để không double-count khi admin xóa 1 payment cũ
  // (deleteCourtRentPayment ghi 1 row direction=in với reversalOfId trỏ về
  // original). Còn lại: sum amount của out, trừ amount của in (mảnh reversal
  // chưa được pair với original cùng có ở đây — phòng race).
  const reversedIds = new Set(
    groupTxs
      .map((t) => t.reversalOfId)
      .filter((id): id is number => id !== null),
  );
  let groupExpenseCourtRent = 0;
  let groupExpenseInventory = 0;
  for (const t of groupTxs) {
    if (reversedIds.has(t.id)) continue; // bị reversal khác chỉ tới → bỏ
    if (t.reversalOfId !== null) continue; // chính nó là reversal → bỏ
    const signed = t.direction === "out" ? t.amount : -t.amount;
    if (t.type === "court_rent_payment") groupExpenseCourtRent += signed;
    else if (t.type === "inventory_purchase") groupExpenseInventory += signed;
  }
  const totalGroupExpenses = groupExpenseCourtRent + groupExpenseInventory;
  // Cash flow công thức: contributions vào − refunds ra − chi quỹ chung ra.
  // KHÔNG trừ totalDeductions (deduction từ finalizeSession là member-allocation,
  // không phải cash movement — admin chưa thực sự đưa ai tiền).
  const cashOnHand = totalContributions - totalRefunds - totalGroupExpenses;

  return {
    totalBalance,
    totalContributions,
    totalDeductions,
    totalRefunds,
    memberCount,
    balances,
    cashOnHand,
    totalGroupExpenses,
    groupExpenseCourtRent,
    groupExpenseInventory,
  };
}

// ─── Monthly fund report ───

export interface MonthlyMemberStat {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  contributed: number;
  deducted: number;
  refunded: number;
  pendingClaim: number; // tổng các payment_notifications status=pending của member trong tháng
}

export interface MonthlyFundReport {
  year: number;
  /** 12-element array, index 0 = January */
  months: {
    month: number; // 1..12
    perMember: MonthlyMemberStat[];
    totalContributed: number;
    totalDeducted: number;
    totalRefunded: number;
    totalPendingClaim: number;
  }[];
  yearTotal: {
    contributed: number;
    deducted: number;
    refunded: number;
    pendingClaim: number;
  };
}

/**
 * Báo cáo quỹ theo tháng cho 1 năm cụ thể.
 * Trả về cho từng tháng: contribution / deduction / refund từ ledger,
 * và pendingClaim từ payment_notifications (manual claim chưa duyệt).
 */
export async function getFundYearlyReport(
  year: number,
): Promise<MonthlyFundReport> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      year,
      months: [],
      yearTotal: { contributed: 0, deducted: 0, refunded: 0, pendingClaim: 0 },
    };
  }

  const yearPrefix = `${year}-`;

  const txs = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    with: { member: true },
  });

  // Lọc theo year tại JS để tránh phải LIKE trên timestamp
  const txsThisYear = txs.filter(
    (t) => t.createdAt && t.createdAt.startsWith(yearPrefix),
  );

  // Pending fund claims: payment_notifications senderBank=manual, status=pending,
  // memo bắt đầu "FWBB QUY"
  const { paymentNotifications } = await import("@/db/schema");
  const claims = await db.query.paymentNotifications.findMany({
    where: and(
      eq(paymentNotifications.senderBank, "manual"),
      eq(paymentNotifications.status, "pending"),
    ),
  });
  const claimsThisYear = claims.filter(
    (c) => c.receivedAt && c.receivedAt.startsWith(yearPrefix),
  );

  // Map memberId từ memo "FWBB QUY {id}" của claim
  function memberIdFromClaim(c: {
    transferContent: string | null;
  }): number | null {
    if (!c.transferContent) return null;
    const m = c.transferContent.toUpperCase().match(/QUY\s+(\d{1,5})/);
    return m ? parseInt(m[1], 10) : null;
  }

  const memberMap = new Map<
    number,
    {
      id: number;
      name: string;
      avatarKey: string | null;
      avatarUrl: string | null;
    }
  >();
  for (const t of txsThisYear) {
    if (t.member && !memberMap.has(t.member.id)) {
      memberMap.set(t.member.id, {
        id: t.member.id,
        name: t.member.name,
        avatarKey: t.member.avatarKey ?? null,
        avatarUrl: t.member.avatarUrl ?? null,
      });
    }
  }
  // also include members from pending claims (in case không có ledger)
  const claimMemberIds = claimsThisYear
    .map(memberIdFromClaim)
    .filter((id): id is number => id !== null);
  if (claimMemberIds.length > 0) {
    const claimMembers = await db.query.members.findMany({
      where: inArray(members.id, [...new Set(claimMemberIds)]),
    });
    for (const m of claimMembers) {
      if (!memberMap.has(m.id)) {
        memberMap.set(m.id, {
          id: m.id,
          name: m.name,
          avatarKey: m.avatarKey ?? null,
          avatarUrl: m.avatarUrl ?? null,
        });
      }
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => {
    const monthIdx = i + 1;
    const perMember = new Map<number, MonthlyMemberStat>();
    function ensure(id: number): MonthlyMemberStat {
      let s = perMember.get(id);
      if (!s) {
        const m = memberMap.get(id) ?? {
          id,
          name: `Member ${id}`,
          avatarKey: null,
          avatarUrl: null,
        };
        s = {
          memberId: id,
          memberName: m.name,
          memberAvatarKey: m.avatarKey,
          memberAvatarUrl: m.avatarUrl,
          contributed: 0,
          deducted: 0,
          refunded: 0,
          pendingClaim: 0,
        };
        perMember.set(id, s);
      }
      return s;
    }

    let totalContributed = 0;
    let totalDeducted = 0;
    let totalRefunded = 0;
    let totalPendingClaim = 0;

    for (const t of txsThisYear) {
      if (!t.createdAt || t.memberId == null) continue;
      const m = parseInt(t.createdAt.slice(5, 7), 10);
      if (m !== monthIdx) continue;
      const s = ensure(t.memberId);
      if (t.type === "fund_contribution") {
        s.contributed += t.amount;
        totalContributed += t.amount;
      } else if (t.type === "fund_deduction") {
        s.deducted += t.amount;
        totalDeducted += t.amount;
      } else if (t.type === "fund_refund") {
        s.refunded += t.amount;
        totalRefunded += t.amount;
      }
    }

    for (const c of claimsThisYear) {
      if (!c.receivedAt || c.amount == null) continue;
      const m = parseInt(c.receivedAt.slice(5, 7), 10);
      if (m !== monthIdx) continue;
      const memId = memberIdFromClaim(c);
      if (memId == null) continue;
      const s = ensure(memId);
      s.pendingClaim += c.amount;
      totalPendingClaim += c.amount;
    }

    return {
      month: monthIdx,
      perMember: Array.from(perMember.values()).sort((a, b) =>
        a.memberName.localeCompare(b.memberName),
      ),
      totalContributed,
      totalDeducted,
      totalRefunded,
      totalPendingClaim,
    };
  });

  const yearTotal = months.reduce(
    (acc, m) => ({
      contributed: acc.contributed + m.totalContributed,
      deducted: acc.deducted + m.totalDeducted,
      refunded: acc.refunded + m.totalRefunded,
      pendingClaim: acc.pendingClaim + m.totalPendingClaim,
    }),
    { contributed: 0, deducted: 0, refunded: 0, pendingClaim: 0 },
  );

  return { year, months, yearTotal };
}

/**
 * Lấy danh sách năm có activity (có ít nhất 1 fund transaction) — dùng cho dropdown.
 */
export async function getFundReportYears(): Promise<number[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const txs = await db.query.financialTransactions.findMany({
    where: inArray(financialTransactions.type, FUND_TRANSACTION_TYPES),
    columns: { createdAt: true },
  });

  const years = new Set<number>();
  for (const t of txs) {
    if (t.createdAt) {
      const y = parseInt(t.createdAt.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    }
  }
  // luôn include năm hiện tại
  years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}

// ─── Get pending fund claims (admin) ───

export interface PendingFundClaim {
  id: number;
  memberId: number;
  memberName: string;
  amount: number;
  receivedAt: string;
}

export async function getPendingFundClaims(
  year: number,
  month: number,
): Promise<PendingFundClaim[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const { paymentNotifications } = await import("@/db/schema");
  const claims = await db.query.paymentNotifications.findMany({
    where: and(
      eq(paymentNotifications.senderBank, "manual"),
      eq(paymentNotifications.status, "pending"),
    ),
  });

  const monthPad = String(month).padStart(2, "0");
  const prefix = `${year}-${monthPad}-`;

  const filtered: PendingFundClaim[] = [];
  for (const c of claims) {
    if (!c.receivedAt || !c.receivedAt.startsWith(prefix)) continue;
    if (!c.transferContent || c.amount == null) continue;
    const m = c.transferContent.toUpperCase().match(/QUY\s+(\d{1,5})/);
    if (!m) continue;
    const memberId = parseInt(m[1], 10);
    const member = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true, name: true },
    });
    filtered.push({
      id: c.id,
      memberId,
      memberName: member?.name ?? `Member ${memberId}`,
      amount: c.amount,
      receivedAt: c.receivedAt,
    });
  }
  return filtered;
}

// ─── Confirm a manual fund claim (admin) ───

export async function confirmFundClaim(notificationId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  const { paymentNotifications } = await import("@/db/schema");
  const notif = await db.query.paymentNotifications.findFirst({
    where: eq(paymentNotifications.id, notificationId),
  });
  if (!notif) return { error: t("claimNotFound") };
  if (notif.status !== "pending") return { error: t("claimAlreadyProcessed") };
  if (!notif.transferContent || !notif.amount) {
    return { error: t("claimMissingInfo") };
  }

  const memo = notif.transferContent.toUpperCase();
  const m = memo.match(/QUY\s+(\d{1,5})/);
  if (!m) return { error: t("contributorUnknown") };
  const memberId = parseInt(m[1], 10);
  // Defensive bound — regex \d{1,5} có thể match "0" → memberId=0 query OK
  // nhưng coi là invalid intent (members.id auto-increment bắt đầu từ 1).
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return { error: t("invalidMemberIdInMemo") };
  }

  // Verify member is in fund
  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: t("memberNotFundMember") };

  // Record fund_contribution + mark notification matched. The notification id
  // is a natural idempotency key — re-confirming the same claim never produces
  // a duplicate fund_contribution.
  let replayed = false;
  try {
    await db.transaction(async (tx) => {
      const r = await recordFinancialTransaction(
        {
          type: "fund_contribution",
          direction: "in",
          amount: notif.amount!,
          memberId,
          paymentNotificationId: notif.id,
          description: `Admin xác nhận đóng quỹ — ${formatVND(notif.amount!)}`,
          metadata: { manualConfirmedByAdmin: true, claimId: notif.id },
          idempotencyKey: `confirm-fund-claim-${notif.id}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
      replayed = r.replayed ?? false;

      await tx
        .update(paymentNotifications)
        .set({ status: "matched", matchedTransactionId: r.id })
        .where(eq(paymentNotifications.id, notif.id));
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : t("transactionWriteFailed"),
    };
  }

  // Auto-settle outstanding session debts with the new balance.
  const { autoApplyFundToDebts } = await import("./auto-fund");
  await autoApplyFundToDebts(memberId);

  revalidatePath("/admin/fund");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
  revalidatePath("/");
  return { success: true, replayed };
}

// ─── Update member bank account ───

export async function updateMemberBankAccount(
  memberId: number,
  bankAccountNo: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const trimmed = bankAccountNo.trim();
  if (trimmed && !/^\d{6,20}$/.test(trimmed)) {
    const t = await getTranslations("serverErrors");
    return { error: t("invalidBankAccount") };
  }

  await db
    .update(members)
    .set({ bankAccountNo: trimmed || null })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  return { success: true };
}
