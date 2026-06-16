"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyMemberVotePatch,
  type VoteWithMember,
  type VoteTotalsPatch,
} from "@/lib/optimistic-votes";
import {
  attendingVotesCount,
  countVoteParticipation,
} from "@/lib/vote-list-utils";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

interface SessionVoteOptimisticPanelProps {
  sessionId: number;
  session: {
    date: string;
    startTime: string | null;
    endTime: string | null;
    courtName?: string | null;
    courtMapLink?: string | null;
    status: string | null;
  };
  votes: VoteWithMember[];
  members: Member[];
  currentMemberId: number | null;
  isVotingOpen: boolean;
  /**
   * When set, vote buttons auto-disable once `now >= voteDeadline`, even if
   * `isVotingOpen` (status-based) is still true. Server-side `submitVote` is
   * the source of truth; this is defense-in-depth UI per the vote-deadline spec.
   */
  voteDeadline?: string | null;
  /** Render ở đỉnh SessionCard (vd hàng chip chọn thứ). Forward xuống topSlot. */
  headerSlot?: ReactNode;
}

export function SessionVoteOptimisticPanel({
  sessionId,
  session: sessionMeta,
  votes: serverVotes,
  members,
  currentMemberId,
  isVotingOpen,
  voteDeadline,
  headerSlot,
}: SessionVoteOptimisticPanelProps) {
  const t = useTranslations("sessions");
  const tv = useTranslations("voting");
  const [optimisticVotes, setOptimisticVotes] =
    useState<VoteWithMember[]>(serverVotes);
  const serverVotesRef = useRef<VoteWithMember[]>(serverVotes);

  useEffect(() => {
    serverVotesRef.current = serverVotes;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic list must converge after server revalidation.
    setOptimisticVotes(serverVotes);
  }, [serverVotes]);

  // Defense-in-depth: when `voteDeadline` passes mid-session, flip a local
  // flag so vote buttons disable client-side. Server still rejects with
  // `voteDeadlinePassed` (source of truth) — this just avoids the confusing
  // "countdown shows closed but button still clickable" UX.
  // Init `false` (not Date.now()-based) to stay hydration-safe; the effect
  // below converges to the correct value on the first client tick.
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  useEffect(() => {
    if (!voteDeadline) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- must reset when deadline clears mid-session.
      setDeadlinePassed(false);
      return;
    }
    const msUntil = new Date(voteDeadline).getTime() - Date.now();
    if (msUntil <= 0) {
      setDeadlinePassed(true);
      return;
    }
    setDeadlinePassed(false);
    const timeout = setTimeout(() => setDeadlinePassed(true), msUntil);
    return () => clearTimeout(timeout);
  }, [voteDeadline]);

  const effectiveIsVotingOpen = isVotingOpen && !deadlinePassed;

  // Đếm 1 lần qua helper chung (member play/dine + tổng khách) — SINGLE SOURCE,
  // khớp divisor chia tiền của cost-calculator.
  const counts = useMemo(
    () => countVoteParticipation(optimisticVotes),
    [optimisticVotes],
  );
  const playerCount = counts.memberPlay;
  const dinerCount = counts.memberDine;
  const totalGuestPlay = counts.guestPlay;
  const totalGuestDine = counts.guestDine;
  const listHeadCount = useMemo(
    () => attendingVotesCount(optimisticVotes),
    [optimisticVotes],
  );

  const myVote = currentMemberId
    ? optimisticVotes.find((v) => v.memberId === currentMemberId)
    : undefined;

  const me = currentMemberId
    ? members.find((m) => m.id === currentMemberId)
    : undefined;
  const currentWithPartner = myVote
    ? (myVote.withPartner ?? false)
    : (me?.defaultWithPartner ?? false);

  const optimisticListSync =
    currentMemberId != null
      ? {
          apply: (patch: VoteTotalsPatch) => {
            setOptimisticVotes((prev) =>
              applyMemberVotePatch(
                prev,
                sessionId,
                members,
                currentMemberId,
                patch,
              ),
            );
          },
          revert: () => setOptimisticVotes([...serverVotesRef.current]),
        }
      : undefined;

  return (
    <>
      <SessionCard
        date={sessionMeta.date}
        startTime={sessionMeta.startTime}
        endTime={sessionMeta.endTime}
        courtName={sessionMeta.courtName}
        courtMapLink={sessionMeta.courtMapLink}
        status={sessionMeta.status}
        playerCount={playerCount}
        dinerCount={dinerCount}
        guestPlayCount={totalGuestPlay}
        guestDineCount={totalGuestDine}
        voteDeadline={voteDeadline ?? null}
        topSlot={headerSlot}
      />

      {effectiveIsVotingOpen && (
        <Card className="border-primary/20 bg-card/95 supports-[backdrop-filter]:bg-card/85 sticky bottom-20 z-30 shadow-lg backdrop-blur sm:static sm:shadow-sm">
          <CardContent className="p-4">
            <h2 className="mb-3 font-semibold">{t("yourVote")}</h2>
            <VoteButtons
              sessionId={sessionId}
              currentWillPlay={myVote?.willPlay ?? false}
              currentWillDine={myVote?.willDine ?? false}
              currentGuestPlayCount={myVote?.guestPlayCount ?? 0}
              currentGuestDineCount={myVote?.guestDineCount ?? 0}
              currentWithPartner={currentWithPartner}
              optimisticListSync={optimisticListSync}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 text-lg font-bold sm:text-xl">
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="inline-flex items-baseline whitespace-nowrap">
                <span className="pr-1">{t("voteList")}</span>
                <span className="text-muted-foreground">(</span>
                <span className="text-primary text-2xl leading-none font-extrabold tabular-nums sm:text-3xl">
                  {listHeadCount}
                </span>
                <span className="text-muted-foreground tabular-nums">/</span>
                <span className="text-muted-foreground tabular-nums">
                  {members.length}
                </span>
                <span className="text-muted-foreground">)</span>
              </span>
              {totalGuestPlay > 0 && (
                <span className="text-muted-foreground text-base font-normal whitespace-nowrap">
                  +{" "}
                  <span className="text-primary text-lg font-bold tabular-nums">
                    {totalGuestPlay}
                  </span>{" "}
                  {tv("guestSummaryPlayTail", { count: totalGuestPlay })}
                </span>
              )}
              {totalGuestDine > 0 && (
                <span className="text-muted-foreground text-base font-normal whitespace-nowrap">
                  +{" "}
                  <span className="text-lg font-bold text-orange-600 tabular-nums dark:text-orange-400">
                    {totalGuestDine}
                  </span>{" "}
                  {tv("guestSummaryDineTail", { count: totalGuestDine })}
                </span>
              )}
            </span>
          </h2>
          <VoteList
            votes={optimisticVotes}
            members={members}
            currentMemberId={currentMemberId}
          />
        </CardContent>
      </Card>
    </>
  );
}
