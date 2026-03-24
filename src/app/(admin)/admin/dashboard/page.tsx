import { db } from "@/db";
import { sessions, sessionDebts, members } from "@/db/schema";
import { eq, and, gte, desc, or, ne } from "drizzle-orm";
import { getDebtSummary } from "@/actions/finance";
import { checkLowStock } from "@/actions/inventory";
import { getNextSession } from "@/actions/sessions";
import { getTranslations } from "next-intl/server";
import { DashboardClient } from "./dashboard-client";
import { PasswordChangeForm } from "./password-change-form";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const tInv = await getTranslations("inventory");

  // 1. Total outstanding debt
  const allDebts = await db.query.sessionDebts.findMany();
  const totalOutstanding = allDebts
    .filter((d) => !d.adminConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

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

  // 6. Recent payments (last 10 confirmed debts)
  const recentPayments = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.adminConfirmed, true),
    with: {
      member: true,
      session: true,
    },
    orderBy: [desc(sessionDebts.adminConfirmedAt)],
  });

  const recentPaymentCards = recentPayments.slice(0, 10).map((d) => ({
    id: d.id,
    memberName: d.member.name,
    sessionDate: d.session.date,
    amount: d.totalAmount,
    confirmedAt: d.adminConfirmedAt || "",
  }));

  const upcomingSession = nextSession
    ? {
        id: nextSession.id,
        date: nextSession.date,
        status: nextSession.status as string,
        courtName: nextSession.court?.name || null,
        startTime: nextSession.startTime || "20:30",
        endTime: nextSession.endTime || "22:30",
      }
    : null;

  const lowStockWarning = lowStockResult.isLow
    ? `${tInv("totalStock")}: ${lowStockResult.totalQua} ${tInv("piece")}`
    : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("overview")}</h1>
      <DashboardClient
        totalOutstanding={totalOutstanding}
        lowStockWarning={lowStockWarning}
        lowStockCount={lowStockResult.isLow ? 1 : 0}
        activeMembersCount={activeMembers.length}
        sessionsThisMonth={sessionsThisMonth}
        upcomingSession={upcomingSession}
        recentPayments={recentPaymentCards}
      />
      <PasswordChangeForm />
    </div>
  );
}
