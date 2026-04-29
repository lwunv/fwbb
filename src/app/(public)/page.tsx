import { getNextSession, getLatestCompletedSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getUserFromCookie } from "@/lib/user-identity";
import { getFundBalance } from "@/lib/fund-calculator";
import { SessionCard } from "@/components/sessions/session-card";
import { SessionVoteOptimisticPanel } from "@/components/sessions/session-vote-optimistic-panel";
import { FundBalanceBanner } from "@/components/finance/fund-balance-banner";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/shared/auto-refresh";

export default async function HomePage() {
  const [nextSession, user, tDashboard] = await Promise.all([
    getNextSession(),
    getUserFromCookie(),
    getTranslations("dashboard"),
  ]);

  const members = await getActiveMembers();

  // Merged Quỹ + Nợ model: only one number matters per user — the fund
  // balance. Negative = đang nợ, zero = hết quỹ, positive = còn quỹ.
  let userFundBalance = 0;
  if (user) {
    userFundBalance = (await getFundBalance(user.memberId)).balance;
  }
  const hasOutstandingDebt = userFundBalance < 0;

  // Trước 2 ngày: còn nợ → ưu tiên buổi đã chơi gần đây + thanh toán (không vote)
  if (nextSession && user && hasOutstandingDebt) {
    const latestSession = await getLatestCompletedSession();

    return (
      <div className="mx-auto max-w-lg space-y-6">
        <AutoRefresh />
        <FundBalanceBanner balance={userFundBalance} memberId={user.memberId} />
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          {latestSession ? (
            <SessionCard
              date={latestSession.date}
              startTime={latestSession.startTime}
              endTime={latestSession.endTime}
              courtName={latestSession.court?.name}
              courtMapLink={latestSession.court?.mapLink ?? null}
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
      </div>
    );
  }

  // Buổi sắp tới + vote (toàn bộ khách; hoặc thành viên đã hết nợ)
  if (nextSession) {
    const votes = await getSessionVotes(nextSession.id);

    const isVotingOpen =
      nextSession.status === "voting" || nextSession.status === "confirmed";

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <AutoRefresh />
        {user && (
          <FundBalanceBanner
            balance={userFundBalance}
            memberId={user.memberId}
          />
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
      {user && (
        <FundBalanceBanner balance={userFundBalance} memberId={user.memberId} />
      )}
      {latestSession ? (
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          <SessionCard
            date={latestSession.date}
            startTime={latestSession.startTime}
            endTime={latestSession.endTime}
            courtName={latestSession.court?.name}
            courtMapLink={latestSession.court?.mapLink ?? null}
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
    </div>
  );
}
