"use server";

import { db } from "@/db";
import { sessions, courts, financialTransactions } from "@/db/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

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

export interface CourtRentReport {
  year: number;
  months: CourtRentMonthSummary[];
  yearTotal: {
    expected: number;
    paid: number;
    passRevenue: number;
    remaining: number;
  };
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

  // Court rent payments
  const payments = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
  });

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

  for (const p of payments) {
    const target = metaTargetMonth(p.metadataJson);
    if (!target) continue;
    if (!target.startsWith(`${year}-`)) continue;
    const m = parseInt(target.slice(5, 7), 10);
    const summary = monthMap.get(m);
    if (!summary) continue;
    summary.paidTotal += p.amount;
  }

  const months: CourtRentMonthSummary[] = [];
  let expected = 0;
  let paid = 0;
  let passRevenueTotal = 0;
  for (let m = 1; m <= 12; m++) {
    const s = monthMap.get(m)!;
    s.remaining = Math.max(0, s.expectedTotal - s.paidTotal);
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
      remaining: Math.max(0, expected - paid),
    },
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
  const all = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
    orderBy: [desc(financialTransactions.createdAt)],
  });

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
}): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    return { error: "Năm không hợp lệ" };
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { error: "Tháng không hợp lệ" };
  }
  if (
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 1_000_000_000
  ) {
    return { error: "Số tiền không hợp lệ" };
  }

  let courtId: number | null = null;
  if (input.courtId) {
    const c = await db.query.courts.findFirst({
      where: eq(courts.id, input.courtId),
      columns: { id: true },
    });
    if (!c) return { error: "Sân không tồn tại" };
    courtId = c.id;
  }

  const targetMonth = `${input.year}-${String(input.month).padStart(2, "0")}`;
  await db.insert(financialTransactions).values({
    type: "court_rent_payment",
    direction: "out",
    amount: input.amount,
    memberId: null,
    sessionId: null,
    debtId: null,
    description:
      input.note ??
      `Trả tiền sân tháng ${String(input.month).padStart(2, "0")}/${input.year}`,
    metadataJson: JSON.stringify({
      targetMonth,
      courtId,
    }),
  });

  revalidatePath("/admin/court-rent");
  revalidatePath("/admin/finance");
  return { success: true };
}

export async function deleteCourtRentPayment(
  paymentId: number,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const tx = await db.query.financialTransactions.findFirst({
    where: and(
      eq(financialTransactions.id, paymentId),
      eq(financialTransactions.type, "court_rent_payment"),
    ),
  });
  if (!tx) return { error: "Không tìm thấy giao dịch" };

  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.id, paymentId));

  revalidatePath("/admin/court-rent");
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
