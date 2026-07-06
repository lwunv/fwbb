import { db } from "@/db";
import { PUBLIC_MEMBER_COLUMNS } from "@/lib/optimistic-votes";
import {
  sessions,
  courts,
  members,
  shuttlecockBrands,
  sessionMinDeductionExemptions,
  financialTransactions,
} from "@/db/schema";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { ymdInVN } from "@/lib/date-format";
import { getDefaultCourt, getSessionDaysOfWeek } from "@/actions/settings";
import { getWeekBadmintonDays } from "@/actions/sessions";
import { SessionList, type StatusFilter } from "./session-list";

const PAGE_SIZE = 10;

const STATUS_FILTERS = [
  "all",
  "voting",
  "needsConfirm",
  "completed",
  "cancelled",
] as const satisfies readonly StatusFilter[];

/** YYYY-MM-DD hợp lệ (thô, đủ để chặn giá trị rác vào query). */
function isYmd(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    from?: string;
    to?: string;
    view?: string;
  }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const statusParam = (sp.status ?? "all") as StatusFilter;
  const statusFilter: StatusFilter = STATUS_FILTERS.includes(statusParam)
    ? statusParam
    : "all";
  // Date-range filter (tùy chọn) — chỉ nhận YYYY-MM-DD hợp lệ.
  const fromDate = isYmd(sp.from) ? sp.from : null;
  const toDate = isYmd(sp.to) ? sp.to : null;
  const viewMode = sp.view === "list" ? "list" : "cards";

  // Where clause theo status filter:
  // - "voting"        → active upcoming/today (status voting/confirmed + date >= today)
  // - "needsConfirm"  → past pending (status voting/confirmed + date < today)
  // - "completed"     → status = completed
  // - "cancelled"     → status = cancelled
  // - "all"           → undefined (no filter)
  const today = ymdInVN();
  // Dùng chung cho whereClause (tab "voting") lẫn activeVotingFirst (sort ưu
  // tiên ở tab "all") — tránh 2 nơi định nghĩa "đang mở vote" lệch nhau.
  const isActiveVoting = and(
    inArray(sessions.status, ["voting", "confirmed"]),
    gte(sessions.date, today),
  );
  const statusClause =
    statusFilter === "voting"
      ? isActiveVoting
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

  // Kết hợp status + khoảng ngày (from/to). `and(...[])` bỏ undefined tự động;
  // rỗng hết → undefined (không lọc).
  const dateConds = [
    fromDate ? gte(sessions.date, fromDate) : undefined,
    toDate ? lte(sessions.date, toDate) : undefined,
  ].filter(Boolean);
  const whereClause =
    dateConds.length > 0 ? and(statusClause, ...dateConds) : statusClause;

  // 2-wave fetch: count trước để clamp page, rồi fetch slice theo safePage.
  // Tránh case URL `?page=99` nhưng thực tế chỉ có 3 trang → fetch empty slice.
  const [
    activeCourts,
    activeMembers,
    activeBrands,
    totalRows,
    defaultCourt,
    sessionDays,
    weekBadmintonDays,
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
    getWeekBadmintonDays(),
  ]);

  // Selector tuần đích cho admin (T2/4/6) — lightweight: chỉ id+status để chip
  // biết ngày nào đã có buổi (cuộn tới) vs chưa (mở dialog tạo, prefill ngày).
  const weekDays = weekBadmintonDays.map((d) => ({
    date: d.date,
    sessionId: d.session?.id ?? null,
    status: d.session?.status ?? null,
  }));

  // Admin's memberId — pass xuống SessionList để phân biệt "Khách Admin"
  // (invitedBy=admin) khi render expanded attendee list. Không có admin =
  // null → mọi guest đều coi là personal.
  const adminRow = await db.query.admins.findFirst({
    columns: { memberId: true },
  });
  const adminMemberId = adminRow?.memberId ?? null;

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(pageNum, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  // Buổi ĐANG THỰC SỰ mở vote (status voting/confirmed + date >= today, khớp
  // định nghĩa bucket "voting" ở whereClause trên) luôn lên ĐẦU trang "all" —
  // đó là buổi admin cần chú ý nhất. Cố tình KHÔNG dùng status='voting' đơn
  // thuần: buổi quá hạn chưa chốt sổ (needsConfirm) vẫn mang status 'voting'
  // nhưng không phải buổi "đang mở vote", không nên tranh vị trí đầu với buổi
  // thật sự đang active. Trong tab "voting"/"needsConfirm"/"completed"/
  // "cancelled", whereClause đã lọc đồng nhất 1 bucket nên CASE này là no-op
  // (không đổi hành vi sẵn có của các tab đó).
  const activeVotingFirst = sql`CASE WHEN ${isActiveVoting} THEN 0 ELSE 1 END`;
  const sessionOrderBy =
    statusFilter === "voting"
      ? [activeVotingFirst, asc(sessions.date)]
      : [activeVotingFirst, desc(sessions.date)];

  const allSessions = await db.query.sessions.findMany({
    where: whereClause,
    orderBy: sessionOrderBy,
    limit: PAGE_SIZE,
    offset,
    with: {
      court: true,
      // Whitelist member cols — s.votes ships raw to the client SessionList, so
      // never serialize PII (matches getSessionVotes + the narrowed Vote type).
      votes: { with: { member: { columns: PUBLIC_MEMBER_COLUMNS } } },
      debts: { with: { member: true } },
      shuttlecocks: { with: { brand: true } },
      // attendees: locked-in headcount for completed sessions. votes can be
      // stale (member voted but didn't show, or admin added a walk-in at
      // finalize time) so completed sessions MUST count from attendees to
      // match the stored debt split. See [[project-finance-money-flow-bugs]].
      attendees: {
        with: {
          member: true,
          invitedBy: true,
        },
      },
    },
  });

  // Bulk-load exemptions cho tất cả sessions trong page — 1 query thay vì
  // N để giảm DB round-trip. Group theo sessionId trong JS.
  const sessionIds = allSessions.map((s) => s.id);
  const exemptionRows =
    sessionIds.length > 0
      ? await db
          .select({
            sessionId: sessionMinDeductionExemptions.sessionId,
            memberId: sessionMinDeductionExemptions.memberId,
          })
          .from(sessionMinDeductionExemptions)
          .where(inArray(sessionMinDeductionExemptions.sessionId, sessionIds))
      : [];
  const exemptionsBySession = new Map<number, number[]>();
  for (const row of exemptionRows) {
    const list = exemptionsBySession.get(row.sessionId) ?? [];
    list.push(row.memberId);
    exemptionsBySession.set(row.sessionId, list);
  }

  const memberIds = activeMembers.map((m) => m.id);
  const memberTxs =
    memberIds.length > 0
      ? await db
          .select({
            memberId: financialTransactions.memberId,
            type: financialTransactions.type,
            amount: financialTransactions.amount,
            id: financialTransactions.id,
            reversalOfId: financialTransactions.reversalOfId,
          })
          .from(financialTransactions)
          .where(inArray(financialTransactions.memberId, memberIds))
      : [];

  // Filter out null memberIds (group-level transactions like inventory_purchase
  // don't have a member). Phải narrow trước khi pass vì
  // `computeBalancesForMembers` yêu cầu `memberId: number` (non-null).
  const memberTxsFiltered = memberTxs.filter(
    (tx): tx is typeof tx & { memberId: number } => tx.memberId !== null,
  );
  const memberBalances = computeBalancesForMembers(
    memberIds,
    memberTxsFiltered,
  );

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
      courtPriceOverridden: s.courtPriceOverridden ?? false,
      diningBill: s.diningBill ?? 0,
      adminGuestPlayCount: s.adminGuestPlayCount ?? 0,
      adminGuestDineCount: s.adminGuestDineCount ?? 0,
      useMinDeduction: s.useMinDeduction ?? false,
      exemptMemberIds: exemptionsBySession.get(s.id) ?? [],
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
      voteDeadline: s.voteDeadline ?? null,
      // attendees gắn member + invitedBy để client render expanded list cho
      // completed sessions. Map về shape gọn để không nhồi cả member object.
      attendees: s.attendees.map((a) => ({
        memberId: a.memberId,
        memberName: a.member?.name ?? null,
        memberAvatarKey: a.member?.avatarKey ?? null,
        memberAvatarUrl: a.member?.avatarUrl ?? null,
        guestName: a.guestName,
        isGuest: a.isGuest ?? false,
        attendsPlay: a.attendsPlay ?? false,
        attendsDine: a.attendsDine ?? false,
        invitedById: a.invitedById,
        invitedByName: a.invitedBy?.name ?? null,
      })),
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
        currentFrom={fromDate}
        currentTo={toDate}
        viewMode={viewMode}
        defaultCourtId={defaultCourt?.id ?? null}
        sessionDays={sessionDays}
        memberBalances={memberBalances}
        adminMemberId={adminMemberId}
        weekDays={weekDays}
      />
    </div>
  );
}
