import { getNextSession, getLatestCompletedSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getDebtsForMember } from "@/actions/finance";
import { getUserFromCookie } from "@/lib/user-identity";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { DebtList } from "@/components/finance/debt-list";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function HomePage() {
  const [nextSession, user, t, tFinance, tDashboard] = await Promise.all([
    getNextSession(),
    getUserFromCookie(),
    getTranslations("sessions"),
    getTranslations("finance"),
    getTranslations("dashboard"),
  ]);

  const members = await getActiveMembers();

  // SECTION 1: Upcoming session with voting
  if (nextSession) {
    const votes = await getSessionVotes(nextSession.id);

    const playerCount = votes.filter((v) => v.willPlay).length;
    const dinerCount = votes.filter((v) => v.willDine).length;
    const totalGuestPlay = votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0);
    const totalGuestDine = votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0);

    const myVote = user ? votes.find((v) => v.memberId === user.memberId) : null;
    const isVotingOpen = nextSession.status === "voting" || nextSession.status === "confirmed";

    return (
      <div className="space-y-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{tDashboard("upcomingSession")}</h1>
          <CopyLinkButton sessionId={nextSession.id} />
        </div>

        <SessionCard
          date={nextSession.date}
          startTime={nextSession.startTime}
          endTime={nextSession.endTime}
          courtName={nextSession.court?.name}
          courtPrice={nextSession.courtPrice}
          status={nextSession.status}
          playerCount={playerCount}
          dinerCount={dinerCount}
          guestPlayCount={totalGuestPlay}
          guestDineCount={totalGuestDine}
        />

        {isVotingOpen && (
          <Card>
            <CardContent className="p-4">
              <h2 className="font-semibold mb-3">{t("yourVote")}</h2>
              <VoteButtons
                sessionId={nextSession.id}
                currentWillPlay={myVote?.willPlay ?? false}
                currentWillDine={myVote?.willDine ?? false}
                currentGuestPlayCount={myVote?.guestPlayCount ?? 0}
                currentGuestDineCount={myVote?.guestDineCount ?? 0}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">
              {t("voteList")} ({votes.length}/{members.length})
            </h2>
            <VoteList votes={votes} members={members} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // SECTION 2: No upcoming session → show latest completed + debts
  const latestSession = await getLatestCompletedSession();

  // Get user debts
  let userDebts: Array<{
    id: number;
    sessionId: number;
    memberId: number;
    sessionDate: string;
    playAmount: number;
    dineAmount: number;
    guestPlayAmount: number;
    guestDineAmount: number;
    totalAmount: number;
    memberConfirmed: boolean;
    adminConfirmed: boolean;
  }> = [];

  if (user) {
    const debts = await getDebtsForMember(user.memberId, "all");
    userDebts = debts
      .filter((d) => !d.adminConfirmed)
      .map((d) => ({
        id: d.id,
        sessionId: d.sessionId,
        memberId: d.memberId,
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

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Latest session */}
      {latestSession ? (
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          <SessionCard
            date={latestSession.date}
            startTime={latestSession.startTime}
            endTime={latestSession.endTime}
            courtName={latestSession.court?.name}
            courtPrice={latestSession.courtPrice}
            status={latestSession.status}
            playerCount={0}
            dinerCount={0}
            guestPlayCount={0}
            guestDineCount={0}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="text-4xl">🏸</div>
          <h2 className="text-xl font-bold">{tDashboard("noUpcoming")}</h2>
        </div>
      )}

      {/* User debts */}
      {user && userDebts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{tFinance("debts")}</h2>
            <Link href="/my-debts" className="text-sm text-primary hover:underline">
              {tFinance("viewAll")} →
            </Link>
          </div>
          <DebtList debts={userDebts} />
        </div>
      )}
    </div>
  );
}
