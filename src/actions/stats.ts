"use server";

import { db } from "@/db";
import {
  sessions,
  sessionAttendees,
  sessionShuttlecocks,
  sessionDebts,
  members,
} from "@/db/schema";
import { eq, and, gte, desc, sql, inArray } from "drizzle-orm";

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

export async function getActiveMembersStats(
  filter: string = "all"
): Promise<ActiveMemberStat[]> {
  const dateStart = getDateFilterStart(filter);

  // Get all completed sessions with attendees
  const completedSessions = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    with: {
      attendees: true,
    },
  });

  // Filter by date if needed
  const filteredSessions = dateStart
    ? completedSessions.filter((s) => s.date >= dateStart)
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

/** Chi phí gom theo buổi (toàn CLB): sân + cầu + nhậu */
export async function getMonthlyExpenses(
  filter: string = "all",
  groupBy: string = "week",
  forMemberId?: number | null,
): Promise<MonthlyExpense[]> {
  if (forMemberId != null && forMemberId > 0) {
    return getMonthlyExpensesForMember(forMemberId, filter, groupBy);
  }

  const dateStart = getDateFilterStart(filter);

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

    for (const sc of session.shuttlecocks) {
      groupMap[key].shuttlecockCost += Math.round(
        (sc.quantityUsed * sc.pricePerTube) / 12
      );
    }
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
  filter: string,
  groupBy: string,
): Promise<MonthlyExpense[]> {
  const dateStart = getDateFilterStart(filter);

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
  const allShuttlecocks = sessionIds.length > 0
    ? await db.query.sessionShuttlecocks.findMany({
        where: inArray(sessionShuttlecocks.sessionId, sessionIds),
      })
    : [];

  // Build a map of sessionId → shuttlecock cost
  const shuttleCostBySession = new Map<number, number>();
  for (const sc of allShuttlecocks) {
    const prev = shuttleCostBySession.get(sc.sessionId) ?? 0;
    shuttleCostBySession.set(
      sc.sessionId,
      prev + Math.round((sc.quantityUsed * sc.pricePerTube) / 12),
    );
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
    const playShare =
      (debt.playAmount ?? 0) + (debt.guestPlayAmount ?? 0);
    const dineShare =
      (debt.dineAmount ?? 0) + (debt.guestDineAmount ?? 0);

    // Split playShare into court vs shuttle proportionally based on session totals
    const sessionCourtPrice = debt.session.courtPrice ?? 0;
    const sessionShuttleCost = shuttleCostBySession.get(debt.sessionId) ?? 0;
    const sessionPlayTotal = sessionCourtPrice + sessionShuttleCost;

    if (sessionPlayTotal > 0) {
      const courtRatio = sessionCourtPrice / sessionPlayTotal;
      groupMap[key].courtCost += Math.round(playShare * courtRatio);
      groupMap[key].shuttlecockCost += Math.round(playShare * (1 - courtRatio));
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
