import { getSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getUserFromCookie } from "@/lib/user-identity";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";

export default async function VoteSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const [session, user, t] = await Promise.all([
    getSession(sessionId),
    getUserFromCookie(),
    getTranslations("sessions"),
  ]);

  if (!session) notFound();

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
      <div className="flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-lg font-bold flex-1">{t("session")}</h1>
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
            <h2 className="font-semibold mb-3">{t("yourVote")}</h2>
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

      {!isVotingOpen && (
        <Card>
          <CardContent className="p-4 text-center text-muted-foreground">
            {session.status === "cancelled"
              ? t("sessionCancelled")
              : t("sessionCompleted")}
          </CardContent>
        </Card>
      )}

      {/* Vote List */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3">
            {t("voteList")} ({t("votedOf", { voted: votes.length, total: members.length })})
          </h2>
          <VoteList votes={votes} members={members} />
        </CardContent>
      </Card>
    </div>
  );
}
