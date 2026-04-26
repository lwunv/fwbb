"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyMemberVotePatch,
  type VoteWithMember,
} from "@/lib/optimistic-votes";
import { attendingVotesCount } from "@/lib/vote-list-utils";
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
    courtPrice?: number | null;
    status: string | null;
  };
  votes: VoteWithMember[];
  members: Member[];
  currentMemberId: number | null;
  isVotingOpen: boolean;
}

export function SessionVoteOptimisticPanel({
  sessionId,
  session: sessionMeta,
  votes: serverVotes,
  members,
  currentMemberId,
  isVotingOpen,
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

  const playerCount = useMemo(
    () => optimisticVotes.filter((v) => !!v.willPlay).length,
    [optimisticVotes],
  );
  const dinerCount = useMemo(
    () => optimisticVotes.filter((v) => !!v.willDine).length,
    [optimisticVotes],
  );
  const totalGuestPlay = useMemo(
    () => optimisticVotes.reduce((s, v) => s + (v.guestPlayCount ?? 0), 0),
    [optimisticVotes],
  );
  const totalGuestDine = useMemo(
    () => optimisticVotes.reduce((s, v) => s + (v.guestDineCount ?? 0), 0),
    [optimisticVotes],
  );
  const listHeadCount = useMemo(
    () => attendingVotesCount(optimisticVotes),
    [optimisticVotes],
  );

  const myVote = currentMemberId
    ? optimisticVotes.find((v) => v.memberId === currentMemberId)
    : undefined;

  const optimisticListSync =
    currentMemberId != null
      ? {
          apply: (patch: {
            willPlay: boolean;
            willDine: boolean;
            guestPlayCount: number;
            guestDineCount: number;
          }) => {
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
        courtPrice={sessionMeta.courtPrice}
        status={sessionMeta.status}
        playerCount={playerCount}
        dinerCount={dinerCount}
        guestPlayCount={totalGuestPlay}
        guestDineCount={totalGuestDine}
      />

      {isVotingOpen && (
        <Card className="border-primary/20 bg-card/95 supports-[backdrop-filter]:bg-card/85 sticky bottom-20 z-30 shadow-lg backdrop-blur sm:static sm:shadow-sm">
          <CardContent className="p-4">
            <h2 className="mb-3 font-semibold">{t("yourVote")}</h2>
            <VoteButtons
              sessionId={sessionId}
              currentWillPlay={myVote?.willPlay ?? false}
              currentWillDine={myVote?.willDine ?? false}
              currentGuestPlayCount={myVote?.guestPlayCount ?? 0}
              currentGuestDineCount={myVote?.guestDineCount ?? 0}
              optimisticListSync={optimisticListSync}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <h2 className="mb-3 font-semibold">
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="inline-flex items-baseline whitespace-nowrap">
                <span className="pr-1">{t("voteList")}</span>
                <span className="text-muted-foreground">(</span>
                <span className="text-primary text-lg leading-none font-bold tabular-nums sm:text-xl">
                  {listHeadCount}
                </span>
                <span className="text-muted-foreground tabular-nums">/</span>
                <span className="text-muted-foreground tabular-nums">
                  {members.length}
                </span>
                <span className="text-muted-foreground">)</span>
              </span>
              {totalGuestPlay > 0 && (
                <span className="text-muted-foreground font-normal whitespace-nowrap">
                  +{" "}
                  <span className="text-primary font-semibold tabular-nums">
                    {totalGuestPlay}
                  </span>{" "}
                  {tv("guestSummaryPlayTail", { count: totalGuestPlay })}
                </span>
              )}
              {totalGuestDine > 0 && (
                <span className="text-muted-foreground font-normal whitespace-nowrap">
                  +{" "}
                  <span className="font-semibold text-orange-600 tabular-nums dark:text-orange-400">
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
