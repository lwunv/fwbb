import { db } from "@/db";
import { sessions, members } from "@/db/schema";
import { eq, gte } from "drizzle-orm";
import { getAllDebts } from "@/actions/finance";
import { checkLowStock } from "@/actions/inventory";
import { getNextSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getTranslations } from "next-intl/server";
import { DashboardClient } from "./dashboard-client";
import { PasswordChangeForm } from "./password-change-form";
import { getAppName } from "@/actions/settings";

export default async function DashboardPage() {
  const tInv = await getTranslations("inventory");

  // 1. All debts (reuse the same function as finance page)
  const allDebts = await getAllDebts("all");

  const totalOutstanding = allDebts
    .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  // Build unpaid debts grouped by member
  const unpaidDebtsRaw = allDebts.filter((d) => !d.adminConfirmed && !d.memberConfirmed);
  const debtGroupMap = new Map<number, {
    memberId: number;
    memberName: string;
    memberAvatarKey: string | null;
    totalOwed: number;
    debts: { id: number; sessionDate: string; totalAmount: number; memberConfirmed: boolean; adminConfirmed: boolean; playAmount: number; dineAmount: number; guestPlayAmount: number; guestDineAmount: number }[];
  }>();
  for (const d of unpaidDebtsRaw) {
    if (!debtGroupMap.has(d.memberId)) {
      debtGroupMap.set(d.memberId, {
        memberId: d.memberId,
        memberName: d.member.name,
        memberAvatarKey: d.member.avatarKey ?? null,
        totalOwed: 0,
        debts: [],
      });
    }
    const g = debtGroupMap.get(d.memberId)!;
    g.totalOwed += d.totalAmount;
    g.debts.push({
      id: d.id,
      sessionDate: d.session.date,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
      adminConfirmed: d.adminConfirmed ?? false,
      playAmount: d.playAmount ?? 0,
      dineAmount: d.dineAmount ?? 0,
      guestPlayAmount: d.guestPlayAmount ?? 0,
      guestDineAmount: d.guestDineAmount ?? 0,
    });
  }
  const unpaidGroups = Array.from(debtGroupMap.values()).sort((a, b) => b.totalOwed - a.totalOwed);

  // Recent payments: paid/waiting debts sorted by waiting first
  const paidDebts = allDebts
    .filter((d) => d.adminConfirmed || d.memberConfirmed)
    .sort((a, b) => {
      const aWaiting = a.memberConfirmed && !a.adminConfirmed ? 0 : 1;
      const bWaiting = b.memberConfirmed && !b.adminConfirmed ? 0 : 1;
      if (aWaiting !== bWaiting) return aWaiting - bWaiting;
      return (b.adminConfirmedAt ?? b.session.date).localeCompare(a.adminConfirmedAt ?? a.session.date);
    });

  const recentPaymentCards = paidDebts.slice(0, 10).map((d) => ({
    id: d.id,
    memberId: d.memberId,
    memberAvatarKey: d.member.avatarKey ?? null,
    memberName: d.member.name,
    sessionDate: d.session.date,
    amount: d.totalAmount,
    confirmedAt: d.adminConfirmedAt || "",
    memberConfirmed: d.memberConfirmed ?? false,
    adminConfirmed: d.adminConfirmed ?? false,
  }));

  // 2. Low stock
  const lowStockResult = await checkLowStock();

  // 3. Active members count
  const activeMembers = await db.query.members.findMany({
    where: eq(members.isActive, true),
  });

  // 4. Sessions this month
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const allSessions = await db.query.sessions.findMany({
    where: gte(sessions.date, monthStart),
  });
  const sessionsThisMonth = allSessions.length;

  // 5. Upcoming session
  const nextSession = await getNextSession();

  let upcomingSession: {
    id: number;
    date: string;
    status: string;
    courtName: string | null;
    courtMapLink: string | null;
    startTime: string;
    endTime: string;
    playerCount: number;
    dinerCount: number;
    guestPlayCount: number;
    guestDineCount: number;
  } | null = null;

  if (nextSession) {
    const sessionVotes = await getSessionVotes(nextSession.id);
    upcomingSession = {
      id: nextSession.id,
      date: nextSession.date,
      status: nextSession.status as string,
      courtName: nextSession.court?.name || null,
      courtMapLink: nextSession.court?.mapLink || null,
      startTime: nextSession.startTime || "20:30",
      endTime: nextSession.endTime || "22:30",
      playerCount: sessionVotes.filter((v) => v.willPlay).length,
      dinerCount: sessionVotes.filter((v) => v.willDine).length,
      guestPlayCount: sessionVotes.reduce((s, v) => s + (v.guestPlayCount ?? 0), 0),
      guestDineCount: sessionVotes.reduce((s, v) => s + (v.guestDineCount ?? 0), 0),
    };
  }

  const lowStockWarning = lowStockResult.isLow
    ? `${tInv("totalStock")}: ${lowStockResult.totalQua} ${tInv("piece")}`
    : null;

  const appName = await getAppName();

  return (
    <div className="space-y-6">
      <DashboardClient
        appName={appName}
        totalOutstanding={totalOutstanding}
        totalStockQua={lowStockResult.totalQua}
        activeMembersCount={activeMembers.length}
        sessionsThisMonth={sessionsThisMonth}
        upcomingSession={upcomingSession}
        recentPayments={recentPaymentCards}
        unpaidGroups={unpaidGroups}
      />
      <PasswordChangeForm />
    </div>
  );
}
