"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { LogIn } from "lucide-react";
import { SessionCard } from "@/components/sessions/session-card";
import { VoteButtons } from "@/components/sessions/vote-buttons";
import { VoteList } from "@/components/sessions/vote-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  applyMemberVotePatch,
  type VoteWithMember,
  type VoteTotalsPatch,
} from "@/lib/optimistic-votes";
import {
  attendingHeadCount,
  countVoteParticipation,
} from "@/lib/vote-list-utils";
import { isPlayFull, remainingPlaySlots } from "@/lib/vote-capacity";
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
  /** Khách của admin (lưu trên session, không phải vote row) — tính vào tổng
   *  người chơi/nhậu + sức chứa 16. Khách của member đã bỏ. */
  adminGuestPlayCount?: number;
  adminGuestDineCount?: number;
  /** Sức chứa chơi cầu tối đa của buổi (admin set 16/8). Mặc định 16. */
  maxPlayers?: number;
  /** Render ở đỉnh SessionCard (vd hàng chip chọn thứ). Forward xuống topSlot. */
  headerSlot?: ReactNode;
  /** Báo optimisticVotes ra ngoài (week-sessions-view) để badge chip ngày cũng
   *  cập nhật NGAY khi vote — không chờ server revalidate. */
  onOptimisticVotesChange?: (votes: VoteWithMember[]) => void;
}

export function SessionVoteOptimisticPanel({
  sessionId,
  session: sessionMeta,
  votes: serverVotes,
  members,
  currentMemberId,
  isVotingOpen,
  voteDeadline,
  adminGuestPlayCount = 0,
  adminGuestDineCount = 0,
  maxPlayers = 16,
  headerSlot,
  onOptimisticVotesChange,
}: SessionVoteOptimisticPanelProps) {
  const t = useTranslations("sessions");
  const tv = useTranslations("voting");
  const tGuest = useTranslations("publicLayout");
  const [optimisticVotes, setOptimisticVotes] =
    useState<VoteWithMember[]>(serverVotes);
  const serverVotesRef = useRef<VoteWithMember[]>(serverVotes);
  // Portal thanh vote ra document.body → fixed full-width thật (không bị
  // containing-block của tổ tiên có backdrop-blur/transform kéo thụt vào).
  // mounted-gate cho SSR-safe (document chỉ có ở client).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cờ mount 1 lần cho portal client-only.
    setMounted(true);
  }, []);

  useEffect(() => {
    serverVotesRef.current = serverVotes;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic list must converge after server revalidation.
    setOptimisticVotes(serverVotes);
  }, [serverVotes]);

  // Báo optimisticVotes ra ngoài để badge chip ngày (week-sessions-view) đồng
  // bộ optimistic cùng thẻ. Ref giữ callback mới nhất (cập nhật TRONG effect,
  // không mutate lúc render) → effect emit chỉ phụ thuộc optimisticVotes, tránh
  // vòng lặp khi parent truyền arrow inline (đổi identity mỗi render).
  const onOptChangeRef = useRef(onOptimisticVotesChange);
  useEffect(() => {
    onOptChangeRef.current = onOptimisticVotesChange;
  }, [onOptimisticVotesChange]);
  useEffect(() => {
    onOptChangeRef.current?.(optimisticVotes);
  }, [optimisticVotes]);

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
  // khớp divisor chia tiền của cost-calculator. LOẠI vote của member đã khóa
  // (isActive=false): finalize bỏ qua họ (finance.ts buildAttendees) nên không
  // được tính vào sức chứa/"Hết slot" — nếu không sẽ báo hết slot oan.
  const counts = useMemo(
    () =>
      countVoteParticipation(
        optimisticVotes.filter((v) => v.member?.isActive !== false),
      ),
    [optimisticVotes],
  );
  const playerCount = counts.memberPlay;
  const dinerCount = counts.memberDine;
  // Khách hiển thị = khách member (residual, ~0) + khách admin.
  const totalGuestPlay = counts.guestPlay + adminGuestPlayCount;
  const totalGuestDine = counts.guestDine + adminGuestDineCount;
  // Sức chứa chơi cầu: member heads + khách admin, so với maxPlayers (16/8).
  // Đủ → "Hết slot"; còn ≤2 slot → cảnh báo "Còn N slot".
  const playFull = isPlayFull(playerCount + totalGuestPlay, maxPlayers);
  const playRemaining = remainingPlaySlots(
    playerCount + totalGuestPlay,
    maxPlayers,
  );
  const listHeadCount = useMemo(
    () => attendingHeadCount(optimisticVotes),
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

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold sm:text-xl">
              <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="inline-flex items-baseline whitespace-nowrap">
                  <span className="pr-1">{t("voteList")}</span>
                  <span className="text-muted-foreground">(</span>
                  <span className="text-primary text-2xl leading-none font-extrabold tabular-nums sm:text-3xl">
                    {listHeadCount}
                  </span>
                  <span className="text-muted-foreground pl-1 text-base font-normal">
                    {tv("headUnit")}
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
            {/* Badge sức chứa: chuyển từ SessionCard xuống đây (cạnh "Danh
                sách") theo yêu cầu. Hết slot → đỏ; còn 1-2 → cảnh báo cam. */}
            {playFull ? (
              <span className="border-destructive/30 bg-destructive/10 text-destructive inline-flex shrink-0 items-center gap-1 self-center rounded-md border px-2 py-0.5 text-xs font-semibold">
                {tv("slotsFull")}
              </span>
            ) : playRemaining >= 1 && playRemaining <= 2 ? (
              <span className="inline-flex shrink-0 items-center gap-1 self-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                {tv("slotsLeft", { count: playRemaining })}
              </span>
            ) : null}
          </div>
          <VoteList
            votes={optimisticVotes}
            members={members}
            currentMemberId={currentMemberId}
          />
        </CardContent>
      </Card>

      {/* Spacer chừa chỗ cho thanh sticky đáy (vote bar khi đã login, hoặc CTA
          đăng nhập khi là khách) khỏi che danh sách. */}
      {effectiveIsVotingOpen && <div className="h-28" aria-hidden />}

      {/* Thanh FIXED full-width, portal ra body để tràn hết mép màn hình (không
          dính containing-block của tổ tiên có backdrop-blur/transform). Member
          → nút vote; khách chưa login → CTA đăng nhập (cùng khung sticky để UX
          nhất quán). Căn giữa max-w-lg cho desktop; safe-area đáy cho iOS. */}
      {mounted &&
        effectiveIsVotingOpen &&
        createPortal(
          <div className="border-primary/20 bg-card/95 supports-[backdrop-filter]:bg-card/85 fixed inset-x-0 bottom-0 z-40 border-t shadow-[0_-4px_20px_rgba(0,0,0,0.18)] backdrop-blur">
            <div className="mx-auto w-full max-w-lg px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {currentMemberId != null ? (
                <VoteButtons
                  sessionId={sessionId}
                  currentWillPlay={myVote?.willPlay ?? false}
                  currentWillDine={myVote?.willDine ?? false}
                  currentWithPartner={currentWithPartner}
                  playFull={playFull}
                  optimisticListSync={optimisticListSync}
                />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-center text-sm font-semibold">
                    {tGuest("guestVoteCtaTitle")}
                  </p>
                  <Button
                    size="lg"
                    className="min-h-12 w-full"
                    render={<Link href="/login" />}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {tGuest("guestVoteCtaButton")}
                  </Button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
