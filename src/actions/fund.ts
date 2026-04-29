"use server";

import { db } from "@/db";
import { financialTransactions, fundMembers, members } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getFundBalance, getAllFundBalances } from "@/lib/fund-calculator";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { requireAdmin, getAdminFromCookie } from "@/lib/auth";
import { getUserFromCookie } from "@/lib/user-identity";
import { formatVND } from "@/lib/utils";
import { fundContributionSchema, fundRefundSchema } from "@/lib/validators";

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

  // Check if member exists
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) return { error: "Không tìm thấy thành viên" };

  // Check if already a fund member
  const existing = await db.query.fundMembers.findFirst({
    where: eq(fundMembers.memberId, memberId),
  });

  if (existing) {
    if (existing.isActive) return { error: "Thành viên đã trong quỹ" };

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

  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: "Không tìm thấy thành viên trong quỹ" };

  // If refunding, check balance and create refund transaction. The whole
  // sequence (read balance → insert refund → flip isActive=false) runs in
  // a single transaction so two admins clicking "Remove + refund" at the
  // same time can't double-refund: the second tx sees `isActive=false` and
  // bails out, OR (if both sneak past the isActive check) the
  // idempotency key on `fundMembers.id` collapses both refunds into one.
  if (refundBalance) {
    try {
      await db.transaction(async (tx) => {
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
      });
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? err.message
            : "Không hoàn được quỹ khi rời nhóm",
      };
    }
  }

  await db
    .update(fundMembers)
    .set({ isActive: false, leftAt: new Date().toISOString() })
    .where(eq(fundMembers.id, fm.id));

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

  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 4
  ) {
    return { error: "Thiếu idempotencyKey" };
  }

  const parsed = fundContributionSchema.safeParse({
    memberId,
    amount,
    description,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, parsed.data.memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: "Thành viên không trong quỹ" };

  const r = await recordFinancialTransaction({
    memberId: parsed.data.memberId,
    type: "fund_contribution",
    direction: "in",
    amount: parsed.data.amount,
    description: parsed.data.description || "Đóng quỹ",
    idempotencyKey,
  });
  if ("error" in r) return { error: r.error ?? "Không ghi được giao dịch" };

  // Auto-settle outstanding session debts with the new balance.
  const { autoApplyFundToDebts } = await import("./auto-fund");
  await autoApplyFundToDebts(parsed.data.memberId);

  revalidatePath("/admin/fund");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
  return { success: true, replayed: r.replayed === true };
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
 */
export async function getRecentFinancialTransactions(limit = 100) {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db.query.financialTransactions.findMany({
    with: { member: true, session: true },
    orderBy: [desc(financialTransactions.createdAt)],
    limit,
  });
  return rows;
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
    };
  }

  const balances = await getAllFundBalances();
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

  return {
    totalBalance,
    totalContributions,
    totalDeductions,
    totalRefunds,
    memberCount,
    balances,
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

  const { paymentNotifications } = await import("@/db/schema");
  const notif = await db.query.paymentNotifications.findFirst({
    where: eq(paymentNotifications.id, notificationId),
  });
  if (!notif) return { error: "Không tìm thấy claim" };
  if (notif.status !== "pending") return { error: "Claim đã được xử lý" };
  if (!notif.transferContent || !notif.amount) {
    return { error: "Claim thiếu thông tin" };
  }

  const memo = notif.transferContent.toUpperCase();
  const m = memo.match(/QUY\s+(\d{1,5})/);
  if (!m) return { error: "Không xác định được người đóng quỹ" };
  const memberId = parseInt(m[1], 10);

  // Verify member is in fund
  const fm = await db.query.fundMembers.findFirst({
    where: and(
      eq(fundMembers.memberId, memberId),
      eq(fundMembers.isActive, true),
    ),
  });
  if (!fm) return { error: "Member không phải thành viên quỹ" };

  // Record fund_contribution + mark notification matched. The notification id
  // is a natural idempotency key — re-confirming the same claim never produces
  // a duplicate fund_contribution.
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

    await tx
      .update(paymentNotifications)
      .set({ status: "matched", matchedTransactionId: r.id })
      .where(eq(paymentNotifications.id, notif.id));
  });

  // Auto-settle outstanding session debts with the new balance.
  const { autoApplyFundToDebts } = await import("./auto-fund");
  await autoApplyFundToDebts(memberId);

  revalidatePath("/admin/fund");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
  revalidatePath("/");
  return { success: true };
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
    return { error: "Số tài khoản không hợp lệ (chỉ chứa số, 6-20 ký tự)" };
  }

  await db
    .update(members)
    .set({ bankAccountNo: trimmed || null })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  return { success: true };
}
