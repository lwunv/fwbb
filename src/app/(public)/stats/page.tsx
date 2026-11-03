import {
  getActiveMembersStats,
  getMonthlyExpenses,
  getAttendanceTrend,
  getAvailableYears,
} from "@/actions/stats";
import { StatsClient } from "@/app/(admin)/admin/stats/stats-client";
import { getApprovedViewer } from "@/lib/member-auth";
import { redirect } from "next/navigation";

export default async function PublicStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ activeYear?: string; expenseGroup?: string }>;
}) {
  const { activeYear = "all", expenseGroup = "week" } = await searchParams;
  // Chỉ trang chủ public; thống kê nhóm chỉ cho member đã duyệt.
  const viewer = await getApprovedViewer();
  if (viewer.status === "anonymous") redirect("/login");
  if (viewer.status === "blocked") return null;
  const { user } = viewer;

  const [activeMembers, monthlyExpenses, attendance, availableYears] =
    await Promise.all([
      getActiveMembersStats(activeYear),
      getMonthlyExpenses(expenseGroup, user?.memberId ?? null),
      getAttendanceTrend(),
      getAvailableYears(),
    ]);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <StatsClient
        activeMembers={activeMembers}
        monthlyExpenses={monthlyExpenses}
        attendance={attendance}
        expenseGroup={expenseGroup}
        activeYear={activeYear}
        availableYears={availableYears}
      />
    </div>
  );
}
