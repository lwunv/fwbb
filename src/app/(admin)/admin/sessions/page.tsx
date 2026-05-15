import { db } from "@/db";
import { sessions, courts, members, shuttlecockBrands } from "@/db/schema";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { ymdInVN } from "@/lib/date-format";
import { getDefaultCourt, getSessionDaysOfWeek } from "@/actions/settings";
import { SessionList, type StatusFilter } from "./session-list";

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  "all",
  "voting",
  "needsConfirm",
  "completed",
  "cancelled",
] as const satisfies readonly StatusFilter[];

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const statusParam = (sp.status ?? "all") as StatusFilter;
  const statusFilter: StatusFilter = STATUS_FILTERS.includes(statusParam)
    ? statusParam
    : "all";

  // Where clause theo status filter:
  // - "voting"        → active upcoming/today (status voting/confirmed + date >= today)
  // - "needsConfirm"  → past pending (status voting/confirmed + date < today)
  // - "completed"     → status = completed
  // - "cancelled"     → status = cancelled
  // - "all"           → undefined (no filter)
  const today = ymdInVN();
  const whereClause =
    statusFilter === "voting"
      ? and(
          inArray(sessions.status, ["voting", "confirmed"]),
          gte(sessions.date, today),
        )
      : statusFilter === "needsConfirm"
        ? and(
            inArray(sessions.status, ["voting", "confirmed"]),
            lt(sessions.date, today),
          )
        : statusFilter === "completed"
          ? eq(sessions.status, "completed")
          : statusFilter === "cancelled"
            ? eq(sessions.status, "cancelled")
            : undefined;

  // 2-wave fetch: count trước để clamp page, rồi fetch slice theo safePage.
  // Tránh case URL `?page=99` nhưng thực tế chỉ có 3 trang → fetch empty slice.
  const [
    activeCourts,
    activeMembers,
    activeBrands,
    totalRows,
    defaultCourt,
    sessionDays,
  ] = await Promise.all([
    db.query.courts.findMany({
      where: eq(courts.isActive, true),
      orderBy: [courts.name],
    }),
    db.query.members.findMany({
      where: eq(members.isActive, true),
      orderBy: [members.name],
    }),
    db.query.shuttlecockBrands.findMany({
      where: eq(shuttlecockBrands.isActive, true),
      orderBy: [shuttlecockBrands.name],
    }),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sessions)
      .where(whereClause)
      .then((r) => Number(r[0]?.count ?? 0)),
    getDefaultCourt(),
    getSessionDaysOfWeek(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(pageNum, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const allSessions = await db.query.sessions.findMany({
    where: whereClause,
    orderBy: [desc(sessions.date)],
    limit: PAGE_SIZE,
    offset,
    with: {
      court: true,
      votes: { with: { member: true } },
      debts: { with: { member: true } },
      shuttlecocks: { with: { brand: true } },
      // attendees: locked-in headcount for completed sessions. votes can be
      // stale (member voted but didn't show, or admin added a walk-in at
      // finalize time) so completed sessions MUST count from attendees to
      // match the stored debt split. See [[project-finance-money-flow-bugs]].
      attendees: true,
    },
  });

  const sessionCards = allSessions.map((s) => {
    // Completed sessions: real headcount from sessionAttendees (lock-in at
    // finalize). Voting/confirmed: live count from votes (no attendees yet).
    let playerCount: number;
    let dinerCount: number;
    let guestPlayCount: number;
    let guestDineCount: number;
    if (s.status === "completed") {
      playerCount = s.attendees.filter(
        (a) => !a.isGuest && a.attendsPlay,
      ).length;
      dinerCount = s.attendees.filter(
        (a) => !a.isGuest && a.attendsDine,
      ).length;
      guestPlayCount = s.attendees.filter(
        (a) => a.isGuest && a.attendsPlay,
      ).length;
      guestDineCount = s.attendees.filter(
        (a) => a.isGuest && a.attendsDine,
      ).length;
    } else {
      playerCount = s.votes.filter((v) => v.willPlay).length;
      dinerCount = s.votes.filter((v) => v.willDine).length;
      guestPlayCount =
        s.votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0) +
        (s.adminGuestPlayCount ?? 0);
      guestDineCount =
        s.votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0) +
        (s.adminGuestDineCount ?? 0);
    }
    const totalDebt = s.debts.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidDebt = s.debts
      .filter((d) => d.adminConfirmed)
      .reduce((sum, d) => sum + d.totalAmount, 0);
    const unpaidDebts = s.debts
      .filter((d) => !d.adminConfirmed)
      .map((d) => ({
        debtId: d.id,
        memberId: d.memberId,
        memberName: d.member.name,
        memberAvatarKey: d.member.avatarKey ?? null,
        memberAvatarUrl: d.member.avatarUrl ?? null,
        amount: d.totalAmount,
      }));
    const shuttlecockInfo = s.shuttlecocks.map((sc) => ({
      brandName: sc.brand.name,
      quantity: sc.quantityUsed,
    }));

    const debtMap: Record<
      number,
      { amount: number; adminConfirmed: boolean; debtId: number }
    > = {};
    for (const d of s.debts) {
      debtMap[d.memberId] = {
        amount: d.totalAmount,
        adminConfirmed: d.adminConfirmed ?? false,
        debtId: d.id,
      };
    }

    return {
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      courtId: s.courtId,
      courtQuantity: s.courtQuantity ?? 1,
      courtName: s.court?.name ?? null,
      courtMapLink: s.court?.mapLink ?? null,
      courtPrice: s.courtPrice,
      diningBill: s.diningBill ?? 0,
      adminGuestPlayCount: s.adminGuestPlayCount ?? 0,
      adminGuestDineCount: s.adminGuestDineCount ?? 0,
      playerCount,
      dinerCount,
      guestPlayCount,
      guestDineCount,
      totalDebt,
      paidDebt,
      unpaidDebts,
      shuttlecockInfo,
      votes: s.votes,
      shuttlecocks: s.shuttlecocks,
      debtMap,
    };
  });

  return (
    <div>
      <SessionList
        sessions={sessionCards}
        courts={activeCourts}
        members={activeMembers}
        brands={activeBrands}
        currentPage={safePage}
        totalPages={totalPages}
        currentStatusFilter={statusFilter}
        defaultCourtId={defaultCourt?.id ?? null}
        sessionDays={sessionDays}
      />
    </div>
  );
}
