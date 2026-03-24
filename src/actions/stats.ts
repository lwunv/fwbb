"use server";

import { db } from "@/db";
import {
  sessions,
  sessionAttendees,
  sessionShuttlecocks,
  sessionDebts,
  members,
} from "@/db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";

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
      if (attendee.attendsPlay && attendee.attendsDine)
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

export async function getMonthlyExpenses(
  filter: string = "all"
): Promise<MonthlyExpense[]> {
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

  // Group by month
  const monthlyMap: Record<
    string,
    { courtCost: number; shuttlecockCost: number; diningCost: number }
  > = {};

  for (const session of filteredSessions) {
    const month = session.date.substring(0, 7); // YYYY-MM
    if (!monthlyMap[month]) {
      monthlyMap[month] = { courtCost: 0, shuttlecockCost: 0, diningCost: 0 };
    }

    monthlyMap[month].courtCost += session.courtPrice || 0;
    monthlyMap[month].diningCost += session.diningBill || 0;

    for (const sc of session.shuttlecocks) {
      // quantityUsed is in qua (individual shuttlecocks), pricePerTube is per tube (12 qua)
      monthlyMap[month].shuttlecockCost += Math.round(
        (sc.quantityUsed * sc.pricePerTube) / 12
      );
    }
  }

  return Object.entries(monthlyMap)
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

export async function getAttendanceTrend(
  filter: string = "all"
): Promise<AttendancePoint[]> {
  const dateStart = getDateFilterStart(filter);

  const completedSessions = await db.query.sessions.findMany({
    where: eq(sessions.status, "completed"),
    with: {
      attendees: true,
    },
    orderBy: [sessions.date],
  });

  const filteredSessions = dateStart
    ? completedSessions.filter((s) => s.date >= dateStart)
    : completedSessions;

  return filteredSessions.map((session) => ({
    sessionId: session.id,
    date: session.date,
    playerCount: session.attendees.filter((a) => a.attendsPlay).length,
    dinerCount: session.attendees.filter((a) => a.attendsDine).length,
  }));
}
