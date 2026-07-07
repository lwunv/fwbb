import { getSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getUserFromCookie } from "@/lib/user-identity";
import { SessionVoteOptimisticPanel } from "@/components/sessions/session-vote-optimistic-panel";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";

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

  // Chỉ trang chủ mở public; link vote 1 buổi vẫn cần đăng nhập (scope "chỉ
  // trang chủ"). Có thể mở public sau nếu muốn dùng cho link chia sẻ.
  if (!user) redirect("/login");

  if (!session) notFound();

  const [votes, members] = await Promise.all([
    getSessionVotes(session.id),
    getActiveMembers(),
  ]);

  // Helper canonical (deadline-aware) — khớp gate server-side của submitVote.
  // KHÔNG chỉ check status: tránh controls render enabled quá deadline khi JS
  // tắt / client timer regress (defense-in-depth).
  const isVotingOpen = isVoteOpen({
    status: session.status as SessionStatus,
    voteDeadline: session.voteDeadline ?? null,
  }).open;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="flex-1 text-lg font-bold">{t("session")}</h1>
        <CopyLinkButton sessionId={session.id} />
      </div>

      {!isVotingOpen && (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-center">
            {session.status === "cancelled"
              ? t("sessionCancelled")
              : t("sessionCompleted")}
          </CardContent>
        </Card>
      )}

      <SessionVoteOptimisticPanel
        sessionId={session.id}
        session={{
          date: session.date,
          startTime: session.startTime,
          endTime: session.endTime,
          courtName: session.court?.name,
          courtMapLink: session.court?.mapLink ?? null,
          status: session.status,
        }}
        votes={votes}
        members={members}
        currentMemberId={user?.memberId ?? null}
        isVotingOpen={isVotingOpen}
        voteDeadline={session.voteDeadline}
        adminGuestPlayCount={session.adminGuestPlayCount ?? 0}
        adminGuestDineCount={session.adminGuestDineCount ?? 0}
        maxPlayers={session.maxPlayers ?? 16}
      />
    </div>
  );
}
