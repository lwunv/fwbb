import { getNextSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getUserFromCookie } from "@/lib/user-identity";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";

export default async function HomePage() {
  const [session, user] = await Promise.all([
    getNextSession(),
    getUserFromCookie(),
  ]);

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <div className="text-4xl">🏸</div>
        <h2 className="text-xl font-bold">Khong co buoi choi sap toi</h2>
        <p className="text-muted-foreground text-center">
          Chua co buoi choi nao duoc len lich. Vui long quay lai sau.
        </p>
      </div>
    );
  }

  const [votes, members] = await Promise.all([
    getSessionVotes(session.id),
    getActiveMembers(),
  ]);

  const playerCount = votes.filter((v) => v.willPlay).length;
  const dinerCount = votes.filter((v) => v.willDine).length;
  const totalGuestPlay = votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0);
  const totalGuestDine = votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0);

  // Find current user's vote
  const myVote = user ? votes.find((v) => v.memberId === user.memberId) : null;

  const isVotingOpen = session.status === "voting" || session.status === "confirmed";

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Session Card */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Buoi choi sap toi</h1>
        <CopyLinkButton sessionId={session.id} />
      </div>

      <SessionCard
        date={session.date}
        startTime={session.startTime}
        endTime={session.endTime}
        courtName={session.court?.name}
        courtPrice={session.courtPrice}
        status={session.status}
        playerCount={playerCount}
        dinerCount={dinerCount}
        guestPlayCount={totalGuestPlay}
        guestDineCount={totalGuestDine}
      />

      {/* Vote Buttons */}
      {isVotingOpen && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">Vote cua ban</h2>
            <VoteButtons
              sessionId={session.id}
              currentWillPlay={myVote?.willPlay ?? false}
              currentWillDine={myVote?.willDine ?? false}
              currentGuestPlayCount={myVote?.guestPlayCount ?? 0}
              currentGuestDineCount={myVote?.guestDineCount ?? 0}
            />
          </CardContent>
        </Card>
      )}

      {/* Vote List */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3">
            Danh sach ({votes.length}/{members.length} da vote)
          </h2>
          <VoteList votes={votes} members={members} />
        </CardContent>
      </Card>
    </div>
  );
}
