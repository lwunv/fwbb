import { getNextSession, getLatestCompletedSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getDebtsForMember } from "@/actions/finance";
import { getUserFromCookie } from "@/lib/user-identity";
import { isWithinHomeVoteWindow } from "@/lib/home-session";
import { SessionCard } from "@/components/sessions/session-card";
import { SessionVoteOptimisticPanel } from "@/components/sessions/session-vote-optimistic-panel";
import { DebtList } from "@/components/finance/debt-list";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { formatK } from "@/lib/utils";
import Link from "next/link";
import { AutoRefresh } from "@/components/shared/auto-refresh";

async function mapOutstandingDebtsForUser(memberId: number) {
  const debts = await getDebtsForMember(memberId, "all");
  return debts
    .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
    .map((d) => ({
      id: d.id,
      sessionId: d.sessionId,
      memberId: d.memberId,
      memberAvatarKey: d.member?.avatarKey ?? null,
      memberAvatarUrl: d.member?.avatarUrl ?? null,
      sessionDate: d.session.date,
      playAmount: d.playAmount ?? 0,
      dineAmount: d.dineAmount ?? 0,
      guestPlayAmount: d.guestPlayAmount ?? 0,
      guestDineAmount: d.guestDineAmount ?? 0,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
      adminConfirmed: d.adminConfirmed ?? false,
    }));
}

export default async function HomePage() {
  const [nextSession, user, tFinance, tDashboard] = await Promise.all([
    getNextSession(),
    getUserFromCookie(),
    getTranslations("finance"),
    getTranslations("dashboard"),
  ]);

  const members = await getActiveMembers();

  const userDebts = user ? await mapOutstandingDebtsForUser(user.memberId) : [];
  const outstandingTotal = userDebts.reduce((s, d) => s + d.totalAmount, 0);
  const hasOutstandingDebt = userDebts.length > 0;

  // Trước 2 ngày: còn nợ → ưu tiên buổi đã chơi gần đây + thanh toán (không vote)
  if (
    nextSession &&
    user &&
    hasOutstandingDebt &&
    !isWithinHomeVoteWindow(nextSession.date)
  ) {
    const latestSession = await getLatestCompletedSession();

    return (
      <div className="mx-auto max-w-lg space-y-6">
        <AutoRefresh />
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          {latestSession ? (
            <SessionCard
              date={latestSession.date}
              startTime={latestSession.startTime}
              endTime={latestSession.endTime}
              courtName={latestSession.court?.name}
              courtMapLink={latestSession.court?.mapLink ?? null}
              courtPrice={latestSession.courtPrice}
              status={latestSession.status}
              playerCount={0}
              dinerCount={0}
              guestPlayCount={0}
              guestDineCount={0}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {tDashboard("noUpcoming")}
            </p>
          )}
        </div>

        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-3 p-4">
            <p className="text-muted-foreground text-center text-sm">
              {tDashboard("homeDebtVoteWarning")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 text-center">
              <span className="text-muted-foreground text-sm">
                {tDashboard("homeTotalOwed")}
              </span>
              <span className="text-destructive text-lg font-bold tabular-nums">
                {formatK(outstandingTotal)}
              </span>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              <Link
                href="/my-debts"
                className="bg-primary text-primary-foreground hover:bg-primary/80 flex min-h-11 w-full items-center justify-center rounded-xl border border-transparent px-3 py-2 text-center text-base leading-snug font-medium"
              >
                {tFinance("paid")}
              </Link>
              <Link
                href="/my-debts"
                className="border-border bg-background hover:bg-muted/80 flex min-h-11 w-full items-center justify-center rounded-xl border px-3 py-2 text-center text-base leading-snug font-medium"
              >
                {tFinance("detail")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Buổi sắp tới + vote (toàn bộ khách; hoặc thành viên đã hết nợ / trong cửa sổ 2 ngày)
  if (nextSession) {
    const votes = await getSessionVotes(nextSession.id);

    const isVotingOpen =
      nextSession.status === "voting" || nextSession.status === "confirmed";

    const showDebtBanner =
      user && hasOutstandingDebt && isWithinHomeVoteWindow(nextSession.date);

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <AutoRefresh />
        {showDebtBanner && (
          <Card className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/15">
            <CardContent className="space-y-3 p-4">
              <p className="text-center text-sm text-amber-950 dark:text-amber-100">
                {tDashboard("homeDebtVoteWarning")}
              </p>
              <div className="bg-background/80 dark:bg-background/60 flex flex-wrap items-center justify-center gap-2 rounded-lg p-3 text-center">
                <span className="text-muted-foreground text-sm">
                  {tDashboard("homeTotalOwed")}
                </span>
                <span className="text-destructive text-lg font-bold tabular-nums">
                  {formatK(outstandingTotal)}
                </span>
              </div>
              <div className="grid w-full grid-cols-2 gap-2">
                <Link
                  href="/my-debts"
                  className="bg-primary text-primary-foreground hover:bg-primary/80 flex min-h-11 w-full items-center justify-center rounded-xl border border-transparent px-3 py-2 text-center text-base leading-snug font-medium"
                >
                  {tFinance("paid")}
                </Link>
                <Link
                  href="/my-debts"
                  className="border-border bg-background hover:bg-muted/80 flex min-h-11 w-full items-center justify-center rounded-xl border px-3 py-2 text-center text-base leading-snug font-medium"
                >
                  {tFinance("detail")}
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{tDashboard("upcomingSession")}</h1>
          <CopyLinkButton sessionId={nextSession.id} />
        </div>

        <SessionVoteOptimisticPanel
          sessionId={nextSession.id}
          session={{
            date: nextSession.date,
            startTime: nextSession.startTime,
            endTime: nextSession.endTime,
            courtName: nextSession.court?.name,
            courtMapLink: nextSession.court?.mapLink ?? null,
            courtPrice: nextSession.courtPrice,
            status: nextSession.status,
          }}
          votes={votes}
          members={members}
          currentMemberId={user?.memberId ?? null}
          isVotingOpen={isVotingOpen}
        />
      </div>
    );
  }

  const latestSession = await getLatestCompletedSession();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <AutoRefresh />
      {latestSession ? (
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          <SessionCard
            date={latestSession.date}
            startTime={latestSession.startTime}
            endTime={latestSession.endTime}
            courtName={latestSession.court?.name}
            courtMapLink={latestSession.court?.mapLink ?? null}
            courtPrice={latestSession.courtPrice}
            status={latestSession.status}
            playerCount={0}
            dinerCount={0}
            guestPlayCount={0}
            guestDineCount={0}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center space-y-4 py-8">
          <div className="text-4xl">🏸</div>
          <h2 className="text-xl font-bold">{tDashboard("noUpcoming")}</h2>
        </div>
      )}

      {user && userDebts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{tFinance("debts")}</h2>
            <Link
              href="/my-debts"
              className="text-primary text-sm hover:underline"
            >
              {tFinance("viewAll")} →
            </Link>
          </div>
          <DebtList debts={userDebts} />
        </div>
      )}
    </div>
  );
}
