import Link from "next/link";
import { getUserFromCookie } from "@/lib/user-identity";
import { getDebtsForMember } from "@/actions/finance";
import { getActiveMembers } from "@/actions/members";
import { getTranslations } from "next-intl/server";
import { getFundBalance, isFundMember } from "@/lib/fund-calculator";
import { MyDebtsClient } from "./my-debts-client";

const PAGE_SIZE = 10;

function debtStatusRank(d: {
  memberConfirmed: boolean;
  adminConfirmed: boolean;
}) {
  if (!d.memberConfirmed) return 0;
  if (!d.adminConfirmed) return 1;
  return 2;
}

function sortDebtsForDisplay<
  T extends {
    memberConfirmed: boolean;
    adminConfirmed: boolean;
    sessionDate: string;
  },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ra = debtStatusRank(a);
    const rb = debtStatusRank(b);
    if (ra !== rb) return ra - rb;
    return b.sessionDate.localeCompare(a.sessionDate);
  });
}

export default async function MyDebtsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; member?: string }>;
}) {
  const user = await getUserFromCookie();
  const tHistory = await getTranslations("history");
  const tIdentify = await getTranslations("identify");

  if (!user) {
    return (
      <div className="text-muted-foreground py-16 text-center">
        {tIdentify("selectNameAndPhone")}
      </div>
    );
  }

  const { page: pageParam } = await searchParams;
  const pageRequested = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const members = await getActiveMembers();

  const selectedMemberId: number | "all" = user.memberId;
  const memberDebts = await getDebtsForMember(user.memberId, "all");
  const memberInfo = members.find((m) => m.id === user.memberId);
  const debts = memberDebts.map((d) => ({
    id: d.id,
    sessionId: d.sessionId,
    memberId: d.memberId,
    memberName: memberInfo?.name ?? "Unknown",
    memberAvatarKey: d.member?.avatarKey ?? memberInfo?.avatarKey ?? null,
    memberAvatarUrl: d.member?.avatarUrl ?? memberInfo?.avatarUrl ?? null,
    sessionDate: d.session.date,
    playAmount: d.playAmount ?? 0,
    dineAmount: d.dineAmount ?? 0,
    guestPlayAmount: d.guestPlayAmount ?? 0,
    guestDineAmount: d.guestDineAmount ?? 0,
    totalAmount: d.totalAmount,
    memberConfirmed: d.memberConfirmed ?? false,
    adminConfirmed: d.adminConfirmed ?? false,
  }));

  const sortedDebts = sortDebtsForDisplay(debts);
  const outstandingTotal = sortedDebts
    .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  const totalCount = sortedDebts.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(pageRequested, totalPages);
  const paginatedDebts = sortedDebts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <MyDebtsClient
        debts={paginatedDebts}
        outstandingTotal={outstandingTotal}
        members={members
          .filter((m) => m.id === user.memberId)
          .map((m) => ({
            id: m.id,
            name: m.name,
            avatarKey: m.avatarKey ?? null,
            avatarUrl: m.avatarUrl ?? null,
          }))}
        currentUserId={user.memberId}
        selectedMemberId={selectedMemberId}
        fundBalance={
          (await isFundMember(user.memberId))
            ? (await getFundBalance(user.memberId)).balance
            : null
        }
      />
      {totalCount > 0 && totalPages > 1 && (
        <nav
          className="flex flex-wrap items-center justify-center gap-3 pt-2 text-sm"
          aria-label={tHistory("paginationNav")}
        >
          <span className="text-muted-foreground tabular-nums">
            {tHistory("pageOf", { current: currentPage, total: totalPages })}
          </span>
          <div className="flex items-center gap-2">
            {currentPage > 1 ? (
              <Link
                href={buildMyDebtsHref(currentPage - 1)}
                className="border-border bg-background hover:bg-muted/80 rounded-md border px-3 py-1.5 font-medium transition-colors"
              >
                {tHistory("prevPage")}
              </Link>
            ) : (
              <span className="text-muted-foreground cursor-not-allowed rounded-md border border-transparent px-3 py-1.5">
                {tHistory("prevPage")}
              </span>
            )}
            {currentPage < totalPages ? (
              <Link
                href={buildMyDebtsHref(currentPage + 1)}
                className="border-border bg-background hover:bg-muted/80 rounded-md border px-3 py-1.5 font-medium transition-colors"
              >
                {tHistory("nextPage")}
              </Link>
            ) : (
              <span className="text-muted-foreground cursor-not-allowed rounded-md border border-transparent px-3 py-1.5">
                {tHistory("nextPage")}
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function buildMyDebtsHref(page: number) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `/my-debts?${q}` : "/my-debts";
}
