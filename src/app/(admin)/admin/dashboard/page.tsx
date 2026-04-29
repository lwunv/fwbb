import { db } from "@/db";
import { sessions, members, financialTransactions } from "@/db/schema";
import { eq, gte, lt, and } from "drizzle-orm";
import {
  getFundMembersWithBalances,
  getRecentFinancialTransactions,
} from "@/actions/fund";
import { mergeLegacyDebtsIntoFund } from "@/actions/merge-debt-fund";
import { getStockByBrand } from "@/actions/inventory";
import { getNextSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { DashboardClient } from "./dashboard-client";
import { getAppName } from "@/actions/settings";
import { ymdInVN } from "@/lib/date-format";

export default async function DashboardPage() {
  // Idempotent migration before reading balances.
  await mergeLegacyDebtsIntoFund();

  // Mô hình Quỹ + Nợ đã gộp: "nợ" = số dư âm trong quỹ.
  const fundMembers = await getFundMembersWithBalances();

  let totalOutstanding = 0;
  let totalPositiveBalance = 0;
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
    } else if (fm.balance.balance > 0) {
      totalPositiveBalance += fm.balance.balance;
    }
  }
  owingMembers.sort((a, b) => b.amount - a.amount);
  const topOwingMembers = owingMembers.slice(0, 5);

  // Inventory breakdown per brand
  const stockByBrand = await getStockByBrand();
  const activeStock = stockByBrand.filter((s) => s.isActive);
  const totalStockQua = activeStock.reduce(
    (sum, s) => sum + s.currentStockQua,
    0,
  );
  const lowStockBrands = activeStock.filter((s) => s.isLowStock);

  // Active members count
  const activeMembers = await db.query.members.findMany({
    where: eq(members.isActive, true),
  });

  // Sessions this month — VN local YYYY-MM
  const todayVN = ymdInVN();
  const yearVN = parseInt(todayVN.slice(0, 4), 10);
  const monthVN = parseInt(todayVN.slice(5, 7), 10);
  const monthStart = `${yearVN}-${String(monthVN).padStart(2, "0")}-01`;
  const nextMonth = monthVN === 12 ? 1 : monthVN + 1;
  const nextMonthYear = monthVN === 12 ? yearVN + 1 : yearVN;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const monthSessions = await db.query.sessions.findMany({
    where: and(
      gte(sessions.date, monthStart),
      lt(sessions.date, nextMonthStart),
    ),
    columns: {
      id: true,
      date: true,
      courtPrice: true,
      status: true,
    },
  });
  const sessionsThisMonth = monthSessions.length;
  const completedSessionsThisMonth = monthSessions.filter(
    (s) => s.status === "completed",
  ).length;
  const courtRentExpectedThisMonth = monthSessions
    .filter((s) => s.status !== "cancelled")
    .reduce((s, x) => s + (x.courtPrice ?? 0), 0);

  // Financial transactions this month — aggregate by type/direction
  // We use createdAt filter (gte VN month start in UTC ≈ same day) — small
  // edge at month boundary acceptable for a dashboard summary tile.
  const monthTxs = await db.query.financialTransactions.findMany({
    where: and(
      gte(financialTransactions.createdAt, monthStart),
      lt(financialTransactions.createdAt, nextMonthStart),
    ),
    columns: {
      type: true,
      direction: true,
      amount: true,
      metadataJson: true,
    },
  });

  let monthIn = 0;
  let monthOut = 0;
  let monthInventorySpend = 0;
  let monthCourtRentPaid = 0;
  for (const t of monthTxs) {
    if (t.direction === "in") monthIn += t.amount;
    else if (t.direction === "out") monthOut += t.amount;
    if (t.type === "inventory_purchase" && t.direction === "out") {
      monthInventorySpend += t.amount;
    }
    if (t.type === "court_rent_payment" && t.direction === "out") {
      // Only count payments targeted at this month
      try {
        const meta = t.metadataJson
          ? (JSON.parse(t.metadataJson) as { targetMonth?: unknown })
          : null;
        const target =
          meta && typeof meta.targetMonth === "string"
            ? meta.targetMonth
            : null;
        if (target === `${yearVN}-${String(monthVN).padStart(2, "0")}`) {
          monthCourtRentPaid += t.amount;
        }
      } catch {
        // ignore malformed metadata
      }
    }
  }

  // Court-rent paid for THIS month — query all court_rent_payment with
  // metadata.targetMonth = current month (regardless of when paid).
  const allCourtRentPayments = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
    columns: { amount: true, direction: true, metadataJson: true },
  });
  let courtRentPaidThisMonth = 0;
  const monthKey = `${yearVN}-${String(monthVN).padStart(2, "0")}`;
  for (const p of allCourtRentPayments) {
    if (p.direction !== "out") continue;
    if (!p.metadataJson) continue;
    try {
      const meta = JSON.parse(p.metadataJson) as { targetMonth?: unknown };
      if (meta?.targetMonth === monthKey) courtRentPaidThisMonth += p.amount;
    } catch {
      // skip
    }
  }
  const courtRentRemainingThisMonth = Math.max(
    0,
    courtRentExpectedThisMonth - courtRentPaidThisMonth,
  );

  // Recent financial transactions (last 5) — for activity feed
  const recentTxsRaw = await getRecentFinancialTransactions(5);
  const recentTransactions = recentTxsRaw.map((r) => ({
    id: r.id,
    type: r.type,
    direction: r.direction,
    amount: r.amount,
    description: r.description,
    createdAt: r.createdAt ?? "",
    memberId: r.memberId ?? null,
    memberName: r.member?.nickname || r.member?.name || null,
    memberAvatarKey: r.member?.avatarKey ?? null,
    memberAvatarUrl: r.member?.avatarUrl ?? null,
  }));

  // Upcoming session
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
    votedCount: number;
    totalEligibleVoters: number;
  } | null = null;

  if (nextSession) {
    const sessionVotes = await getSessionVotes(nextSession.id);
    const votedCount = sessionVotes.filter(
      (v) => v.willPlay || v.willDine,
    ).length;
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
      votedCount,
      totalEligibleVoters: activeMembers.length,
    };
  }

  // Brand-level inventory tiles
  const inventoryByBrand = activeStock.map((s) => ({
    brandId: s.brandId,
    brandName: s.brandName,
    pricePerTube: s.pricePerTube,
    currentStockQua: s.currentStockQua,
    ong: s.ong,
    qua: s.qua,
    isLowStock: s.isLowStock,
  }));

  const appName = await getAppName();

  return (
    <div className="space-y-6">
      <DashboardClient
        appName={appName}
        totalOutstanding={totalOutstanding}
        totalPositiveBalance={totalPositiveBalance}
        owingCount={owingMembers.length}
        topOwingMembers={topOwingMembers}
        totalStockQua={totalStockQua}
        lowStockBrandCount={lowStockBrands.length}
        inventoryByBrand={inventoryByBrand}
        activeMembersCount={activeMembers.length}
        sessionsThisMonth={sessionsThisMonth}
        completedSessionsThisMonth={completedSessionsThisMonth}
        upcomingSession={upcomingSession}
        monthIn={monthIn}
        monthOut={monthOut}
        monthInventorySpend={monthInventorySpend}
        courtRentExpectedThisMonth={courtRentExpectedThisMonth}
        courtRentPaidThisMonth={courtRentPaidThisMonth}
        courtRentRemainingThisMonth={courtRentRemainingThisMonth}
        recentTransactions={recentTransactions}
        currentMonth={monthVN}
        currentYear={yearVN}
      />
    </div>
  );
}
