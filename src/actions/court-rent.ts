"use server";

import { db } from "@/db";
import { sessions, courts, financialTransactions } from "@/db/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getTranslations } from "next-intl/server";

export interface CourtRentMonthSummary {
  /** YYYY-MM */
  monthKey: string;
  year: number;
  month: number; // 1..12
  /** Sessions tháng này (cả completed/cancelled, exclude voting) */
  sessionCount: number;
  /** Sessions có 2+ sân */
  extraCourtSessions: number;
  /** Tổng `courtPrice` đã tính cho các session active (status != cancelled) */
  expectedTotal: number;
  /** Tổng `passRevenue` của các session cancelled */
  passRevenue: number;
  /** Tổng đã trả landlord (court_rent_payment direction=out) — assigned to this month */
  paidTotal: number;
  /** Số tiền chưa trả: expected - paid */
  remaining: number;
}

export interface OrphanedPayment {
  id: number;
  amount: number;
  description: string | null;
  createdAt: string;
  /** Lý do orphan: "no_target_month" | "out_of_year" */
  reason: "no_target_month" | "out_of_year";
}

export interface CourtRentReport {
  year: number;
  months: CourtRentMonthSummary[];
  yearTotal: {
    expected: number;
    paid: number;
    passRevenue: number;
    remaining: number;
  };
  /** Payments không gán được vào tháng nào trong năm — admin cần review.
   * Trước đây silent skip → tiền biến mất khỏi report mà không cảnh báo. */
  orphanedPayments: OrphanedPayment[];
}

interface PaymentRow {
  id: number;
  amount: number;
  description: string | null;
  createdAt: string;
  /** target month from metadata: "YYYY-MM" */
  targetMonth: string | null;
  courtId: number | null;
  courtName: string | null;
}

export async function getCourtRentReport(
  year: number,
): Promise<CourtRentReport> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      year,
      months: [],
      yearTotal: { expected: 0, paid: 0, passRevenue: 0, remaining: 0 },
      orphanedPayments: [],
    };
  }

  // Sessions trong năm
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const allSessions = await db.query.sessions.findMany({
    where: and(gte(sessions.date, yearStart), lt(sessions.date, yearEnd)),
    columns: {
      id: true,
      date: true,
      courtPrice: true,
      courtQuantity: true,
      passRevenue: true,
      status: true,
    },
  });

  // Court rent payments — exclude reversed pairs (original + its reversal
  // cancel out. Skip both rows to avoid double-counting the original AND
  // the +amount reversal).
  const allPayments = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
  });
  const reversedIds = new Set(
    allPayments.filter((p) => p.reversalOfId).map((p) => p.reversalOfId!),
  );
  const payments = allPayments.filter(
    (p) => !p.reversalOfId && !reversedIds.has(p.id),
  );

  function metaTargetMonth(metaJson: string | null): string | null {
    if (!metaJson) return null;
    try {
      const o = JSON.parse(metaJson) as { targetMonth?: unknown };
      return typeof o.targetMonth === "string" ? o.targetMonth : null;
    } catch {
      return null;
    }
  }

  const monthMap = new Map<number, CourtRentMonthSummary>();
  for (let m = 1; m <= 12; m++) {
    monthMap.set(m, {
      monthKey: `${year}-${String(m).padStart(2, "0")}`,
      year,
      month: m,
      sessionCount: 0,
      extraCourtSessions: 0,
      expectedTotal: 0,
      passRevenue: 0,
      paidTotal: 0,
      remaining: 0,
    });
  }

  for (const s of allSessions) {
    if (!s.date) continue;
    const m = parseInt(s.date.slice(5, 7), 10);
    const summary = monthMap.get(m);
    if (!summary) continue;
    summary.sessionCount++;
    if ((s.courtQuantity ?? 1) > 1) summary.extraCourtSessions++;
    if (s.status !== "cancelled") {
      summary.expectedTotal += s.courtPrice ?? 0;
    }
    if (s.passRevenue && s.passRevenue > 0) {
      summary.passRevenue += s.passRevenue;
    }
  }

  // Track payments không gán được vào tháng nào trong năm hiện tại — để UI
  // cảnh báo admin thay vì silent skip. Trường hợp:
  //   - `targetMonth` thiếu/lỗi JSON → orphan reason="no_target_month".
  //   - `targetMonth` thuộc năm khác → skip (đã có report năm đó).
  const orphanedPayments: OrphanedPayment[] = [];
  for (const p of payments) {
    const target = metaTargetMonth(p.metadataJson);
    if (!target) {
      orphanedPayments.push({
        id: p.id,
        amount: p.amount,
        description: p.description,
        createdAt: p.createdAt ?? "",
        reason: "no_target_month",
      });
      continue;
    }
    if (!target.startsWith(`${year}-`)) continue;
    const m = parseInt(target.slice(5, 7), 10);
    const summary = monthMap.get(m);
    if (!summary) {
      orphanedPayments.push({
        id: p.id,
        amount: p.amount,
        description: p.description,
        createdAt: p.createdAt ?? "",
        reason: "out_of_year",
      });
      continue;
    }
    summary.paidTotal += p.amount;
  }

  // KHÔNG clamp `remaining` về 0 — giữ giá trị âm nếu paid > expected để
  // UI render badge "Trả thừa" cảnh báo admin. Trước đây clamp im lặng làm
  // overpayment biến mất.
  const months: CourtRentMonthSummary[] = [];
  let expected = 0;
  let paid = 0;
  let passRevenueTotal = 0;
  for (let m = 1; m <= 12; m++) {
    const s = monthMap.get(m)!;
    s.remaining = s.expectedTotal - s.paidTotal;
    months.push(s);
    expected += s.expectedTotal;
    paid += s.paidTotal;
    passRevenueTotal += s.passRevenue;
  }

  return {
    year,
    months,
    yearTotal: {
      expected,
      paid,
      passRevenue: passRevenueTotal,
      remaining: expected - paid,
    },
    orphanedPayments,
  };
}

/**
 * Liệt kê các payment cho 1 tháng cụ thể (để admin review/edit/xóa).
 */
export async function getCourtRentPayments(
  year: number,
  month: number,
): Promise<PaymentRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const target = `${year}-${String(month).padStart(2, "0")}`;
  const allRaw = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
    orderBy: [desc(financialTransactions.createdAt)],
  });
  // Bỏ cặp đã reverse (original + reversal cancel out → admin không thấy
  // row đã xóa logic).
  const reversedIds = new Set(
    allRaw.filter((p) => p.reversalOfId).map((p) => p.reversalOfId!),
  );
  const all = allRaw.filter((p) => !p.reversalOfId && !reversedIds.has(p.id));

  const courtRows = await db.query.courts.findMany({
    columns: { id: true, name: true },
  });
  const courtMap = new Map(courtRows.map((c) => [c.id, c.name]));

  return all
    .map((t): PaymentRow | null => {
      let targetMonth: string | null = null;
      let courtId: number | null = null;
      try {
        const m = t.metadataJson
          ? (JSON.parse(t.metadataJson) as {
              targetMonth?: unknown;
              courtId?: unknown;
            })
          : {};
        if (typeof m.targetMonth === "string") targetMonth = m.targetMonth;
        if (typeof m.courtId === "number") courtId = m.courtId;
      } catch {
        // ignore
      }
      if (targetMonth !== target) return null;
      return {
        id: t.id,
        amount: t.amount,
        description: t.description,
        createdAt: t.createdAt ?? "",
        targetMonth,
        courtId,
        courtName: courtId ? (courtMap.get(courtId) ?? null) : null,
      };
    })
    .filter((r): r is PaymentRow => r !== null);
}

export async function recordCourtRentPayment(input: {
  year: number;
  month: number;
  amount: number;
  courtId?: number | null;
  note?: string;
  /** UUID per submit — DB UNIQUE INDEX trên `idempotency_key` chặn double-write
   *  khi admin click 2 lần liên tiếp / mạng trễ → optimistic UI đã reset form. */
  idempotencyKey: string;
}): Promise<{ success: true; replayed: boolean } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    return { error: t("invalidYear") };
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { error: t("invalidMonth") };
  }
  if (
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 1_000_000_000
  ) {
    return { error: t("invalidAmount") };
  }

  if (
    !input.idempotencyKey ||
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length < 4
  ) {
    return { error: t("missingIdempotencyKey") };
  }

  let courtId: number | null = null;
  if (input.courtId) {
    const c = await db.query.courts.findFirst({
      where: eq(courts.id, input.courtId),
      columns: { id: true },
    });
    if (!c) return { error: t("courtNotExists") };
    courtId = c.id;
  }

  // Đi qua `recordFinancialTransaction` helper để: (a) idempotency check + DB
  // UNIQUE fallback cùng 1 đường code với mọi action khác, (b) validate
  // `Number.isInteger(amount) && >= 0` (defence-in-depth dù đã guard ở trên),
  // (c) metadata serialize chuẩn JSON. Trước đây inline `db.insert` bypass
  // helper → mất defence layer.
  const targetMonth = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const r = await recordFinancialTransaction({
    type: "court_rent_payment",
    direction: "out",
    amount: input.amount,
    memberId: null,
    sessionId: null,
    debtId: null,
    description:
      input.note ??
      `Trả tiền sân tháng ${String(input.month).padStart(2, "0")}/${input.year}`,
    metadata: { targetMonth, courtId },
    idempotencyKey: input.idempotencyKey,
  });
  if ("error" in r) {
    return { error: r.error ?? t("transactionWriteFailed") };
  }
  if (r.replayed) return { success: true, replayed: true };

  revalidatePath("/admin/court-rent");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  return { success: true, replayed: false };
}

export async function deleteCourtRentPayment(
  paymentId: number,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const original = await db.query.financialTransactions.findFirst({
    where: and(
      eq(financialTransactions.id, paymentId),
      eq(financialTransactions.type, "court_rent_payment"),
    ),
  });
  if (!original) {
    const t = await getTranslations("serverErrors");
    return { error: t("transactionNotFound") };
  }

  // Reversal pattern thay vì hard-delete — giữ audit trail. Trước đây
  // hard-delete làm reconcile không phân biệt "xóa nhầm" vs "chưa từng tồn
  // tại". Reversal row có `reversalOfId` trỏ về row gốc; khi list payments
  // có thể filter (original ≠ none-reversed) để ẩn cặp đã reverse.
  //
  // Pre-check + insert now happen inside a db.transaction so the
  // read-then-write is atomic. idempotencyKey `delete-court-rent-${paymentId}`
  // is the last-line-of-defence via DB UNIQUE INDEX on idempotency_key.
  try {
    await db.transaction(async (tx) => {
      const existingReversal = await tx.query.financialTransactions.findFirst({
        where: eq(financialTransactions.reversalOfId, paymentId),
        columns: { id: true },
      });
      if (existingReversal) return; // idempotent no-op inside tx

      const r = await recordFinancialTransaction(
        {
          type: "court_rent_payment",
          direction: "in", // ngược direction với original (out → in)
          amount: original.amount,
          memberId: original.memberId,
          sessionId: original.sessionId,
          debtId: original.debtId,
          reversalOfId: original.id,
          description:
            `Hoàn tác trả tiền sân — ${original.description ?? ""}`.trim(),
          metadata: original.metadataJson
            ? (JSON.parse(original.metadataJson) as Record<
                string,
                string | number | boolean | null
              >)
            : null, // copy để filter list theo targetMonth vẫn match
          idempotencyKey: `delete-court-rent-${paymentId}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    const t = await getTranslations("serverErrors");
    return {
      error: err instanceof Error ? err.message : t("transactionWriteFailed"),
    };
  }

  revalidatePath("/admin/court-rent");
  revalidatePath("/admin/fund");
  return { success: true };
}

export async function getCourtRentYears(): Promise<number[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db.query.sessions.findMany({
    columns: { date: true },
  });
  const years = new Set<number>();
  for (const r of rows) {
    if (r.date) {
      const y = parseInt(r.date.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    }
  }
  years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}
