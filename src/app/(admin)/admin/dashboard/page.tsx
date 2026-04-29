import { db } from "@/db";
import { sessions, members } from "@/db/schema";
import { eq, gte } from "drizzle-orm";
import { getFundMembersWithBalances } from "@/actions/fund";
import { mergeLegacyDebtsIntoFund } from "@/actions/merge-debt-fund";
import { checkLowStock } from "@/actions/inventory";
import { getNextSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { DashboardClient } from "./dashboard-client";
import { getAppName } from "@/actions/settings";

export default async function DashboardPage() {
  // Idempotent migration before reading balances.
  await mergeLegacyDebtsIntoFund();

  // Mô hình Quỹ + Nợ đã gộp: "nợ" = số dư âm trong quỹ.
  const fundMembers = await getFundMembersWithBalances();

  let totalOutstanding = 0;
  const owingMembers: {
    memberId: number;
    memberName: string;
    memberAvatarKey: string | null;
    memberAvatarUrl: string | null;
    amount: number;
  }[] = [];
  for (const fm of fundMembers) {
    if (fm.balance.balance < 0) {
      const debt = -fm.balance.balance;
      totalOutstanding += debt;
      owingMembers.push({
        memberId: fm.memberId,
        memberName: fm.member.nickname || fm.member.name,
        memberAvatarKey: fm.member.avatarKey ?? null,
        memberAvatarUrl: fm.member.avatarUrl ?? null,
        amount: debt,
      });
    }
  }
  owingMembers.sort((a, b) => b.amount - a.amount);
  const topOwingMembers = owingMembers.slice(0, 5);

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
      guestPlayCount: sessionVotes.reduce(
        (s, v) => s + (v.guestPlayCount ?? 0),
        0,
      ),
      guestDineCount: sessionVotes.reduce(
        (s, v) => s + (v.guestDineCount ?? 0),
        0,
      ),
    };
  }

  const appName = await getAppName();

  return (
    <div className="space-y-6">
      <DashboardClient
        appName={appName}
        totalOutstanding={totalOutstanding}
        owingCount={owingMembers.length}
        topOwingMembers={topOwingMembers}
        totalStockQua={lowStockResult.totalQua}
        activeMembersCount={activeMembers.length}
        sessionsThisMonth={sessionsThisMonth}
        upcomingSession={upcomingSession}
      />
    </div>
  );
}
