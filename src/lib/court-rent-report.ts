import { and, eq, gte, lt } from "drizzle-orm";
import { financialTransactions, sessions } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { isDefaultSessionDay } from "@/lib/date-format";
import { getDefaultCourt, getSessionDaysOfWeek } from "@/actions/settings";

/**
 * Threshold: court-rent stats chỉ tính từ MỐC này trở đi. Mọi nghĩa vụ tiền sân
 * TRƯỚC mốc bị bỏ qua. Reset 6/2026 theo yêu cầu admin: tháng 5 đã tất toán
 * ngoài hệ thống → dời mốc 1/5 → 1/6 để "Cần trả" của T5 về 0; T6 trở đi vẫn
 * tự tính theo lịch. Format "YYYY-MM-DD", inclusive.
 */
const COURT_RENT_START_DATE = "2026-06-01";

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

/**
 * Báo cáo tiền sân của một năm (lõi của `getCourtRentReport`, không kiểm
 * quyền). Tách ra để cron hằng ngày gọi được; thân hàm giữ nguyên như action.
 */
export async function computeCourtRentReport(
  db: DbOrTx,
  year: number,
): Promise<CourtRentReport> {
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
  // monthlyPrice = giá HIỆN TẠI của default court. Nếu admin thay đổi
  // pricePerSession giữa năm (vd 200K → 220K vào tháng 7), TẤT CẢ các tháng
  // trong report sẽ dùng giá mới 220K — không tracking giá lịch sử per-month.
  // Trade-off: simple model, OK vì group sinh hoạt cộng đồng (price hiếm khi
  // thay đổi). Nếu cần historical pricing, thêm `monthly_price_snapshots`
  // table hoặc tính từ session.courtPrice của các buổi cố định trong tháng.
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
  // nếu thuộc tháng đó. Skip tháng tương lai (monthStart > today) — chưa
  // tới tháng đó thì chưa phát sinh nghĩa vụ trả tiền sân.
  // Skip nếu chưa có default court — không biết hợp đồng tháng từ đâu.
  // TZ note: `new Date("YYYY-MM-DDT00:00:00")` (no Z suffix) → local time. Trên
  // server UTC, `monthStart.toISOString().slice(0,10)` có thể trả về ngày
  // trước đó. Branch logic phía dưới verified hoạt động đúng cả UTC và UTC+7:
  // tháng-cũ-hơn-START → endDate=null → continue; tháng-mới-hơn → loop với
  // monthStart/monthEnd cùng TZ → `getDay()` consistent.
  const today = new Date();
  if (defaultCourtId !== null)
    for (let m = 1; m <= 12; m++) {
      const summary = monthMap.get(m)!;
      const monthStart = new Date(
        `${year}-${String(m).padStart(2, "0")}-01T00:00:00`,
      );
      // Skip future months — fixed rent của tháng chưa tới chưa accrue.
      if (monthStart > today) continue;
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
