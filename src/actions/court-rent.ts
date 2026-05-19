"use server";

import { db } from "@/db";
import { sessions, courts, financialTransactions } from "@/db/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getTranslations } from "next-intl/server";
import { isDefaultSessionDay } from "@/lib/date-format";
import { getDefaultCourt, getSessionDaysOfWeek } from "@/actions/settings";

/**
 * Threshold: court-rent stats chỉ tính từ tháng này trở đi (legacy data trước
 * thời điểm này không phản ánh thuê sân thực tế → admin yêu cầu skip).
 * Format: "YYYY-MM-DD" — start of inclusive.
 */
const COURT_RENT_START_DATE = "2026-05-01";

export interface CourtRentMonthSummary {
  /** YYYY-MM */
  monthKey: string;
  year: number;
  month: number; // 1..12
  /** Sessions tháng này (cả completed/cancelled, exclude voting) */
  sessionCount: number;
  /** Sessions có 2+ sân */
  extraCourtSessions: number;
  /** Sessions vào ngày không phải lịch cố định (vd CN, T3, T5, T7). */
  offScheduleSessions: number;
  /** Tổng `courtPrice` đã tính cho các session active (status != cancelled) */
  expectedTotal: number;
  /** Phần thuê sân theo gói tháng cố định — TÍNH THEO LỊCH:
   *  Đếm số ngày T2/T4/T6 (theo sessionDaysOfWeek) trong tháng × monthlyPrice
   *  của default court. Là toàn bộ hợp đồng tháng — KHÔNG phụ thuộc có
   *  session trong DB hay không.
   *  Trừ trường hợp month thuộc tháng có COURT_RENT_START_DATE: clip
   *  về số ngày từ start trở đi. */
  fixedRentTotal: number;
  /** Phần phát sinh — tính từ session thực tế (status != cancelled):
   *  - Sân thứ 2+ trên buổi cố định tại default court
   *  - Toàn bộ tiền sân trên buổi off-schedule hoặc khác default court
   *  - Phần admin override < monthlyPrice cũng coi là 0 (admin được giảm) */
  extraRentTotal: number;
  /** Tổng `passRevenue` của các session cancelled */
  passRevenue: number;
  /** Tổng đã trả landlord — gộp cả 2 bucket (legacy display). */
  paidTotal: number;
  /** Đã trả cho bucket Fixed (metadata.bucket="fixed", default cho legacy). */
  paidFixedTotal: number;
  /** Đã trả cho bucket Extra (metadata.bucket="extra"). */
  paidExtraTotal: number;
  /** Số tiền chưa trả gộp: expected - paid (legacy display). */
  remaining: number;
  /** Số tiền chưa trả Fixed: fixedRentTotal - paidFixedTotal */
  remainingFixed: number;
  /** Số tiền chưa trả Extra: extraRentTotal - paidExtraTotal */
  remainingExtra: number;
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
    fixedRent: number;
    extraRent: number;
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
      yearTotal: {
        expected: 0,
        fixedRent: 0,
        extraRent: 0,
        paid: 0,
        passRevenue: 0,
        remaining: 0,
      },
      orphanedPayments: [],
    };
  }

  // Sessions trong năm — bắt đầu từ COURT_RENT_START_DATE (legacy skip).
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const effectiveStart =
    yearStart < COURT_RENT_START_DATE ? COURT_RENT_START_DATE : yearStart;
  const [allSessions, defaultCourt, sessionDays] = await Promise.all([
    db.query.sessions.findMany({
      where: and(
        gte(sessions.date, effectiveStart),
        lt(sessions.date, yearEnd),
      ),
      columns: {
        id: true,
        date: true,
        courtId: true,
        courtPrice: true,
        courtQuantity: true,
        passRevenue: true,
        status: true,
      },
    }),
    getDefaultCourt(),
    getSessionDaysOfWeek(),
  ]);
  const defaultCourtId = defaultCourt?.id ?? null;
  const monthlyPrice = defaultCourt?.pricePerSession ?? 200_000;

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

  function parseMeta(metaJson: string | null): {
    targetMonth: string | null;
    bucket: "fixed" | "extra";
  } {
    if (!metaJson) return { targetMonth: null, bucket: "fixed" };
    try {
      const o = JSON.parse(metaJson) as {
        targetMonth?: unknown;
        bucket?: unknown;
      };
      const targetMonth =
        typeof o.targetMonth === "string" ? o.targetMonth : null;
      const bucket: "fixed" | "extra" =
        o.bucket === "extra" ? "extra" : "fixed";
      return { targetMonth, bucket };
    } catch {
      return { targetMonth: null, bucket: "fixed" };
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
      offScheduleSessions: 0,
      expectedTotal: 0,
      fixedRentTotal: 0,
      extraRentTotal: 0,
      passRevenue: 0,
      paidTotal: 0,
      paidFixedTotal: 0,
      paidExtraTotal: 0,
      remaining: 0,
      remainingFixed: 0,
      remainingExtra: 0,
    });
  }

  // Calendar-based Fixed total: count fixed days (T2/T4/T6 per sessionDays)
  // trong từng tháng × monthlyPrice. Clip start theo COURT_RENT_START_DATE
  // nếu thuộc tháng đó.
  // Skip nếu chưa có default court — không biết hợp đồng tháng từ đâu.
  // TZ note: `new Date("YYYY-MM-DDT00:00:00")` (no Z suffix) → local time. Trên
  // server UTC, `monthStart.toISOString().slice(0,10)` có thể trả về ngày
  // trước đó. Branch logic phía dưới verified hoạt động đúng cả UTC và UTC+7:
  // tháng-cũ-hơn-START → endDate=null → continue; tháng-mới-hơn → loop với
  // monthStart/monthEnd cùng TZ → `getDay()` consistent.
  if (defaultCourtId !== null)
    for (let m = 1; m <= 12; m++) {
      const summary = monthMap.get(m)!;
      const monthStart = new Date(
        `${year}-${String(m).padStart(2, "0")}-01T00:00:00`,
      );
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      const start =
        monthStart.toISOString().slice(0, 10) < COURT_RENT_START_DATE &&
        monthEnd.toISOString().slice(0, 10) > COURT_RENT_START_DATE
          ? new Date(COURT_RENT_START_DATE + "T00:00:00")
          : monthStart;
      const endDate =
        monthEnd.toISOString().slice(0, 10) <= COURT_RENT_START_DATE
          ? null
          : monthEnd;
      if (!endDate) continue;
      let fixedDayCount = 0;
      for (let d = new Date(start); d < endDate; d.setDate(d.getDate() + 1)) {
        if (sessionDays.includes(d.getDay())) fixedDayCount++;
      }
      summary.fixedRentTotal = fixedDayCount * monthlyPrice;
    }

  for (const s of allSessions) {
    if (!s.date) continue;
    const m = parseInt(s.date.slice(5, 7), 10);
    const summary = monthMap.get(m);
    if (!summary) continue;
    summary.sessionCount++;
    const qty = s.courtQuantity ?? 1;
    if (qty > 1) summary.extraCourtSessions++;

    const onFixedDay = isDefaultSessionDay(s.date, sessionDays);
    const atDefaultCourt =
      defaultCourtId !== null && s.courtId === defaultCourtId;
    const isRegular = onFixedDay && atDefaultCourt;
    if (!onFixedDay) summary.offScheduleSessions++;

    if (s.status !== "cancelled") {
      const price = s.courtPrice ?? 0;
      summary.expectedTotal += price;
      // Extra rent: tính từ session thực tế.
      //   isRegular session: price > monthlyPrice → phần dư (sân 2+) là extra
      //   off-schedule/khác court: toàn bộ price là extra
      // Fixed rent KHÔNG cộng từ session — đã calendar-based phía trên.
      const fixedPortion = isRegular ? Math.min(price, monthlyPrice) : 0;
      summary.extraRentTotal += price - fixedPortion;
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
    const { targetMonth: target, bucket } = parseMeta(p.metadataJson);
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
    if (bucket === "extra") {
      summary.paidExtraTotal += p.amount;
    } else {
      summary.paidFixedTotal += p.amount;
    }
  }

  // KHÔNG clamp `remaining` về 0 — giữ giá trị âm nếu paid > expected để
  // UI render badge "Trả thừa" cảnh báo admin. Trước đây clamp im lặng làm
  // overpayment biến mất.
  const months: CourtRentMonthSummary[] = [];
  let expected = 0;
  let fixedRent = 0;
  let extraRent = 0;
  let paid = 0;
  let passRevenueTotal = 0;
  for (let m = 1; m <= 12; m++) {
    const s = monthMap.get(m)!;
    // expectedTotal cũ = sum của session active courtPrice. Để Fixed calendar
    // + Extra session khớp với "Cần trả" tổng, override expectedTotal =
    // fixedRentTotal + extraRentTotal.
    s.expectedTotal = s.fixedRentTotal + s.extraRentTotal;
    s.remaining = s.expectedTotal - s.paidTotal;
    s.remainingFixed = s.fixedRentTotal - s.paidFixedTotal;
    s.remainingExtra = s.extraRentTotal - s.paidExtraTotal;
    months.push(s);
    expected += s.expectedTotal;
    fixedRent += s.fixedRentTotal;
    extraRent += s.extraRentTotal;
    paid += s.paidTotal;
    passRevenueTotal += s.passRevenue;
  }

  return {
    year,
    months,
    yearTotal: {
      expected,
      fixedRent,
      extraRent,
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
  /** "fixed" = trả gói tháng cố định; "extra" = trả phát sinh. Default "fixed"
   *  cho backwards-compat. */
  bucket?: "fixed" | "extra";
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
  const bucket: "fixed" | "extra" =
    input.bucket === "extra" ? "extra" : "fixed";
  const r = await recordFinancialTransaction({
    type: "court_rent_payment",
    direction: "out",
    amount: input.amount,
    memberId: null,
    sessionId: null,
    debtId: null,
    description:
      input.note ??
      `Trả tiền sân tháng ${String(input.month).padStart(2, "0")}/${input.year} (${bucket === "extra" ? "phát sinh" : "cố định"})`,
    metadata: { targetMonth, courtId, bucket },
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
