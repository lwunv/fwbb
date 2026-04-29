"use server";

import { db } from "@/db";
import { sessions, sessionShuttlecocks, sessionDebts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { calculateExactShuttlecockCost } from "@/lib/cost-calculator";
import { roundToThousand } from "@/lib/utils";

/**
 * Date-range start cho biểu đồ chi phí, derive từ groupBy:
 *   session → 3 tháng gần nhất
 *   week    → 6 tháng gần nhất
 *   month   → 2 năm gần nhất
 *   year    → all time (null)
 */
function getExpenseRangeStart(groupBy: string): string | null {
  const now = new Date();
  const ymd = (d: Date) => d.toISOString().split("T")[0];
  switch (groupBy) {
    case "session": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      return ymd(d);
    }
    case "week": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return ymd(d);
    }
    case "month": {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 2);
      return ymd(d);
    }
    case "year":
    default:
      return null;
  }
}

export interface ActiveMemberStat {
  memberId: number;
  memberName: string;
  playCount: number;
  dineCount: number;
  bothCount: number;
}

/**
 * yearFilter: "all" | "YYYY" — chỉ giữ buổi có session.date.startsWith(yearFilter).
 */
export async function getActiveMembersStats(
  yearFilter: string = "all",
): Promise<ActiveMemberStat[]> {
  const yearPrefix = /^\d{4}$/.test(yearFilter) ? yearFilter : null;

  const completedSessions = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    with: {
      attendees: true,
    },
  });

  const filteredSessions = yearPrefix
    ? completedSessions.filter((s) => s.date.startsWith(yearPrefix))
    : completedSessions;

  // Get all members
  const allMembers = await db.query.members.findMany();
  const memberMap = new Map(allMembers.map((m) => [m.id, m.name]));

  // Count per member
  const stats: Record<
    number,
    { playCount: number; dineCount: number; bothCount: number }
  > = {};

  for (const session of filteredSessions) {
    for (const attendee of session.attendees) {
      if (!attendee.memberId || attendee.isGuest) continue;
      if (!stats[attendee.memberId]) {
        stats[attendee.memberId] = { playCount: 0, dineCount: 0, bothCount: 0 };
      }
      if (attendee.attendsPlay) stats[attendee.memberId].playCount++;
      if (attendee.attendsDine) stats[attendee.memberId].dineCount++;
      if (attendee.attendsPlay || attendee.attendsDine)
        stats[attendee.memberId].bothCount++;
    }
  }

  return Object.entries(stats)
    .map(([id, counts]) => ({
      memberId: Number(id),
      memberName: memberMap.get(Number(id)) || "Unknown",
      ...counts,
    }))
    .sort((a, b) => b.playCount - a.playCount);
}

export interface MonthlyExpense {
  month: string; // YYYY-MM
  courtCost: number;
  shuttlecockCost: number;
  diningCost: number;
  total: number;
}

/** groupBy: "session" | "week" | "month" | "year" */
function getExpenseGroupKey(date: string, groupBy: string): string {
  switch (groupBy) {
    case "session":
      return date;
    case "week": {
      const d = new Date(date + "T00:00:00");
      const dayOfWeek = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
      return monday.toISOString().split("T")[0];
    }
    case "year":
      return date.substring(0, 4);
    case "month":
    default:
      return date.substring(0, 7);
  }
}

/**
 * Chi phí gom theo buổi (toàn CLB): sân + cầu + nhậu.
 * Date range tự động derive từ groupBy:
 *   session → 3 tháng | week → 6 tháng | month → 2 năm | year → all time
 */
export async function getMonthlyExpenses(
  groupBy: string = "week",
  forMemberId?: number | null,
): Promise<MonthlyExpense[]> {
  if (forMemberId != null && forMemberId > 0) {
    return getMonthlyExpensesForMember(forMemberId, groupBy);
  }

  const dateStart = getExpenseRangeStart(groupBy);

  const completedSessions = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    with: {
      shuttlecocks: true,
    },
  });

  const filteredSessions = dateStart
    ? completedSessions.filter((s) => s.date >= dateStart)
    : completedSessions;

  const groupMap: Record<
    string,
    { courtCost: number; shuttlecockCost: number; diningCost: number }
  > = {};

  for (const session of filteredSessions) {
    const key = getExpenseGroupKey(session.date, groupBy);
    if (!groupMap[key]) {
      groupMap[key] = { courtCost: 0, shuttlecockCost: 0, diningCost: 0 };
    }

    groupMap[key].courtCost += session.courtPrice || 0;
    groupMap[key].diningCost += session.diningBill || 0;

    // Sum exact (float) per row, round once at the end of the session.
    let sessionShuttleExact = 0;
    for (const sc of session.shuttlecocks) {
      sessionShuttleExact += calculateExactShuttlecockCost(
        sc.quantityUsed,
        sc.pricePerTube,
      );
    }
    groupMap[key].shuttlecockCost += roundToThousand(sessionShuttleExact);
  }

  return Object.entries(groupMap)
    .map(([month, costs]) => ({
      month,
      ...costs,
      total: costs.courtCost + costs.shuttlecockCost + costs.diningCost,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Chi phí theo phần của một thành viên (từ session_debts).
 * playAmount bao gồm cả sân + cầu → chia tỷ lệ dựa trên session-level data.
 */
async function getMonthlyExpensesForMember(
  memberId: number,
  groupBy: string,
): Promise<MonthlyExpense[]> {
  const dateStart = getExpenseRangeStart(groupBy);

  const debts = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.memberId, memberId),
    with: { session: true },
  });

  const filtered = debts.filter(
    (d) =>
      d.session.status === "completed" &&
      (!dateStart || d.session.date >= dateStart),
  );

  // Load shuttlecocks separately to avoid relying on nested with
  const sessionIds = [...new Set(filtered.map((d) => d.sessionId))];
  const allShuttlecocks =
    sessionIds.length > 0
      ? await db.query.sessionShuttlecocks.findMany({
          where: inArray(sessionShuttlecocks.sessionId, sessionIds),
        })
      : [];

  // Build a map of sessionId → shuttlecock cost
  // Build exact (float) total per session, round at the end so multi-brand
  // sessions don't accumulate rounding drift.
  const exactBySession = new Map<number, number>();
  for (const sc of allShuttlecocks) {
    const prev = exactBySession.get(sc.sessionId) ?? 0;
    exactBySession.set(
      sc.sessionId,
      prev + calculateExactShuttlecockCost(sc.quantityUsed, sc.pricePerTube),
    );
  }
  const shuttleCostBySession = new Map<number, number>();
  for (const [sid, exact] of exactBySession) {
    shuttleCostBySession.set(sid, roundToThousand(exact));
  }

  const groupMap: Record<
    string,
    { courtCost: number; shuttlecockCost: number; diningCost: number }
  > = {};

  for (const debt of filtered) {
    const key = getExpenseGroupKey(debt.session.date, groupBy);
    if (!groupMap[key]) {
      groupMap[key] = { courtCost: 0, shuttlecockCost: 0, diningCost: 0 };
    }
    const playShare = (debt.playAmount ?? 0) + (debt.guestPlayAmount ?? 0);
    const dineShare = (debt.dineAmount ?? 0) + (debt.guestDineAmount ?? 0);

    // Split playShare into court vs shuttle proportionally based on session totals
    const sessionCourtPrice = debt.session.courtPrice ?? 0;
    const sessionShuttleCost = shuttleCostBySession.get(debt.sessionId) ?? 0;
    const sessionPlayTotal = sessionCourtPrice + sessionShuttleCost;

    if (sessionPlayTotal > 0) {
      const courtRatio = sessionCourtPrice / sessionPlayTotal;
      groupMap[key].courtCost += roundToThousand(playShare * courtRatio);
      groupMap[key].shuttlecockCost += roundToThousand(
        playShare * (1 - courtRatio),
      );
    } else {
      groupMap[key].courtCost += playShare;
    }
    groupMap[key].diningCost += dineShare;
  }

  return Object.entries(groupMap)
    .map(([month, costs]) => ({
      month,
      ...costs,
      total: costs.courtCost + costs.shuttlecockCost + costs.diningCost,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface AttendancePoint {
  sessionId: number;
  date: string;
  playerCount: number;
  dinerCount: number;
}

/** Ngày đầu tháng (tháng hiện tại − 5) → đủ 6 tháng lịch gần nhất, so sánh YYYY-MM-DD */
function getLastSixCalendarMonthsStart(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** Xu hướng điểm danh: luôn 6 tháng lịch gần nhất (không theo TimeFilter) */
export async function getAttendanceTrend(): Promise<AttendancePoint[]> {
  const dateStart = getLastSixCalendarMonthsStart();

  const completedSessions = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    with: {
      attendees: true,
    },
    orderBy: [sessions.date],
  });

  const filteredSessions = completedSessions.filter((s) => s.date >= dateStart);

  return filteredSessions.map((session) => ({
    sessionId: session.id,
    date: session.date,
    playerCount: session.attendees.filter((a) => a.attendsPlay).length,
    dinerCount: session.attendees.filter((a) => a.attendsDine).length,
  }));
}

/**
 * Danh sách các năm có session đã hoàn thành, sort giảm dần (mới nhất trước).
 * Luôn bao gồm năm hiện tại để dropdown không trống lúc khởi tạo CLB mới.
 */
export async function getAvailableYears(): Promise<string[]> {
  const completed = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    columns: { date: true },
  });
  const years = new Set<string>();
  for (const s of completed) {
    if (s.date) years.add(s.date.substring(0, 4));
  }
  years.add(String(new Date().getFullYear()));
  return [...years].sort((a, b) => b.localeCompare(a));
}
