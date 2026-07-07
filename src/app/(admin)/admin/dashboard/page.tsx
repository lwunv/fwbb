import { db } from "@/db";
import {
  sessions,
  members,
  financialTransactions,
  courts,
  shuttlecockBrands,
} from "@/db/schema";
import { eq, gte, lt, and } from "drizzle-orm";
import {
  getFundMembersWithBalances,
  getRecentFinancialTransactions,
} from "@/actions/fund";
import { getFundStatus } from "@/lib/fund-core";
import { mergeLegacyDebtsIntoFund } from "@/actions/merge-debt-fund";
import { getStockByBrand } from "@/actions/inventory";
import {
  getAdminUpcomingSession,
  getSessionExemptions,
} from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getCourtRentReport } from "@/actions/court-rent";
import { bucketMonthlyTransactions } from "@/lib/finance-summary";
import { DashboardClient } from "./dashboard-client";
import {
  getAppName,
  getDefaultCourt,
  getDefaultBrand,
  getSessionDaysOfWeek,
} from "@/actions/settings";
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
  const lowFundMembers: {
    memberId: number;
    memberName: string;
    memberAvatarKey: string | null;
    memberAvatarUrl: string | null;
    balance: number;
  }[] = [];
  for (const fm of fundMembers) {
    const status = getFundStatus(fm.balance.balance);
    if (status === "owing") {
      const debt = -fm.balance.balance;
      totalOutstanding += debt;
      owingMembers.push({
        memberId: fm.memberId,
        memberName: fm.member.nickname || fm.member.name,
        memberAvatarKey: fm.member.avatarKey ?? null,
        memberAvatarUrl: fm.member.avatarUrl ?? null,
        amount: debt,
      });
    } else {
      if (fm.balance.balance > 0) {
        totalPositiveBalance += fm.balance.balance;
      }
      if (status === "lowFund") {
        lowFundMembers.push({
          memberId: fm.memberId,
          memberName: fm.member.nickname || fm.member.name,
          memberAvatarKey: fm.member.avatarKey ?? null,
          memberAvatarUrl: fm.member.avatarUrl ?? null,
          balance: fm.balance.balance,
        });
      }
    }
  }
  owingMembers.sort((a, b) => b.amount - a.amount);
  const topOwingMembers = owingMembers.slice(0, 5);
  lowFundMembers.sort((a, b) => a.balance - b.balance); // smallest balance first

  // Reuse fundMembers balances computed above — no extra query needed.
  const memberBalances: Record<number, number> = {};
  for (const fm of fundMembers) {
    memberBalances[fm.memberId] = fm.balance.balance;
  }

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

  // Admin's memberId — loại khách admin khỏi forecast floor (finalize bỏ qua
  // debt admin → khách admin không bao giờ bị floor 60K).
  const adminRow = await db.query.admins.findFirst({
    columns: { memberId: true },
  });
  const adminMemberId = adminRow?.memberId ?? null;

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

  // Financial transactions this month — bucket by economic meaning (real
  // cash vs internal redistribution vs audit-only). Direct sum of
  // direction=in/out inflated both sides ~2× because:
  //   - bank_payment_received is paired with fund_contribution (×2 in)
  //   - fund_deduction is internal redistribution, not cash leaving admin's
  //     wallet (already covered by inventory_purchase / court_rent_payment).
  //   - debt_*_confirmed are legacy audit rows in the merged Quỹ+Nợ model.
  // Helper canonicalises this — never inline the sum loop again. See
  // [[project-finance-ledger-semantics]] in memory.
  const monthTxs = await db.query.financialTransactions.findMany({
    where: and(
      gte(financialTransactions.createdAt, monthStart),
      lt(financialTransactions.createdAt, nextMonthStart),
    ),
    columns: {
      id: true,
      type: true,
      direction: true,
      amount: true,
      reversalOfId: true,
    },
  });
  const monthFlow = bucketMonthlyTransactions(monthTxs);
  const monthIn = monthFlow.realIn;
  const monthOut = monthFlow.realOut;
  const monthInventorySpend = monthFlow.inventorySpend;

  // Court-rent stats — DELEGATE tới `getCourtRentReport` để dashboard và
  // trang `/admin/court-rent` luôn cùng 1 nguồn truth. Trước đây inline tính
  // sai 2 chỗ: (1) không dedupe payment đã reverse → đếm cả original lẫn
  // reversal, (2) clamp remaining về ≥0 → ẩn overpayment. Delegation cũng
  // tự nhiên respect `courtPriceOverridden` vì cả 2 đều đọc `session.courtPrice`.
  const courtRentReport = await getCourtRentReport(yearVN);
  const monthRent = courtRentReport.months.find((m) => m.month === monthVN);
  const courtRentExpectedThisMonth = monthRent?.expectedTotal ?? 0;
  const courtRentPaidThisMonth = monthRent?.paidTotal ?? 0;
  const courtRentRemainingThisMonth = monthRent?.remaining ?? 0;

  // Recent financial transactions (last 5) — for activity feed.
  // excludeAuditOnly=true: hide debt_* + bank_payment_received audit rows so
  // user doesn't see "2 rows for 1 event" (audit + paired money row). The
  // full transaction log at /admin/fund/transactions still includes them.
  const recentTxsRaw = await getRecentFinancialTransactions(5, {
    excludeAuditOnly: true,
  });
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

  // Buổi cần admin chú ý — ưu tiên hôm nay, fallback hôm qua nếu chưa finalize.
  const nextSession = await getAdminUpcomingSession();

  let upcomingSession: {
    id: number;
    date: string;
    status: string;
    courtId: number | null;
    courtName: string | null;
    courtMapLink: string | null;
    courtQuantity: number;
    courtPrice: number | null;
    courtPriceOverridden: boolean;
    diningBill: number;
    startTime: string;
    endTime: string;
    playerCount: number;
    dinerCount: number;
    guestPlayCount: number;
    guestDineCount: number;
    adminGuestPlayCount: number;
    adminGuestDineCount: number;
    useMinDeduction: boolean;
    voteDeadline: string | null;
    maxPlayers: number;
    exemptMemberIds: number[];
    votedCount: number;
    totalEligibleVoters: number;
    shuttlecocks: {
      id: number;
      brandId: number;
      brandName: string;
      quantityUsed: number;
      pricePerTube: number;
    }[];
    votes: Awaited<ReturnType<typeof getSessionVotes>>;
  } | null = null;

  if (nextSession) {
    const [sessionVotes, exemptions] = await Promise.all([
      getSessionVotes(nextSession.id),
      getSessionExemptions(nextSession.id),
    ]);
    const votedCount = sessionVotes.filter(
      (v) => v.willPlay || v.willDine,
    ).length;
    upcomingSession = {
      id: nextSession.id,
      date: nextSession.date,
      status: nextSession.status as string,
      courtId: nextSession.courtId ?? null,
      courtName: nextSession.court?.name || null,
      courtMapLink: nextSession.court?.mapLink || null,
      courtQuantity: nextSession.courtQuantity ?? 1,
      courtPrice: nextSession.courtPrice ?? null,
      courtPriceOverridden: nextSession.courtPriceOverridden ?? false,
      diningBill: nextSession.diningBill ?? 0,
      startTime: nextSession.startTime || "20:30",
      endTime: nextSession.endTime || "22:30",
      playerCount: sessionVotes.filter((v) => v.willPlay).length,
      dinerCount: sessionVotes.filter((v) => v.willDine).length,
      guestPlayCount:
        sessionVotes.reduce((s, v) => s + (v.guestPlayCount ?? 0), 0) +
        (nextSession.adminGuestPlayCount ?? 0),
      guestDineCount:
        sessionVotes.reduce((s, v) => s + (v.guestDineCount ?? 0), 0) +
        (nextSession.adminGuestDineCount ?? 0),
      adminGuestPlayCount: nextSession.adminGuestPlayCount ?? 0,
      adminGuestDineCount: nextSession.adminGuestDineCount ?? 0,
      useMinDeduction: nextSession.useMinDeduction ?? false,
      voteDeadline: nextSession.voteDeadline ?? null,
      maxPlayers: nextSession.maxPlayers ?? 16,
      exemptMemberIds: exemptions,
      votedCount,
      totalEligibleVoters: activeMembers.length,
      shuttlecocks: nextSession.shuttlecocks.map((s) => ({
        id: s.id,
        brandId: s.brandId,
        brandName: s.brand?.name ?? "",
        quantityUsed: s.quantityUsed,
        pricePerTube: s.pricePerTube,
      })),
      votes: sessionVotes,
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

  // Settings panel data — list courts/brands + currently-resolved defaults
  // (đã fallback qua getDefault*).
  const [allCourts, allBrands, defaultCourt, defaultBrand, sessionDays] =
    await Promise.all([
      db.query.courts.findMany({
        where: eq(courts.isActive, true),
        orderBy: (c, { asc }) => [asc(c.name)],
      }),
      db.query.shuttlecockBrands.findMany({
        where: eq(shuttlecockBrands.isActive, true),
        orderBy: (b, { asc }) => [asc(b.name)],
      }),
      getDefaultCourt(),
      getDefaultBrand(),
      getSessionDaysOfWeek(),
    ]);
  const settingsCourts = allCourts.map((c) => ({
    id: c.id,
    name: c.name,
    pricePerSession: c.pricePerSession,
  }));
  const settingsBrands = allBrands.map((b) => ({
    id: b.id,
    name: b.name,
    pricePerTube: b.pricePerTube,
  }));
  // Full schema records cho inline session editor (CourtSelector cần
  // pricePerSessionRetail, mapLink; ShuttlecockSelector cần object Brand đầy đủ).
  const editorCourts = allCourts;
  const editorBrands = allBrands;

  return (
    <div className="space-y-6">
      <DashboardClient
        appName={appName}
        totalOutstanding={totalOutstanding}
        totalPositiveBalance={totalPositiveBalance}
        owingCount={owingMembers.length}
        topOwingMembers={topOwingMembers}
        lowFundMembers={lowFundMembers}
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
        settingsCourts={settingsCourts}
        settingsBrands={settingsBrands}
        editorCourts={editorCourts}
        editorBrands={editorBrands}
        editorMembers={activeMembers}
        memberBalances={memberBalances}
        adminMemberId={adminMemberId}
        defaultCourtId={defaultCourt?.id ?? null}
        defaultBrandId={defaultBrand?.id ?? null}
        sessionDays={sessionDays}
      />
    </div>
  );
}
