"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
};

type Member = InferSelectModel<typeof membersTable>;

export function VoteList({
  votes,
  members,
  currentMemberId = null,
}: {
  votes: Vote[];
  members: Member[];
  /** Đã vote tham gia → đưa lên đầu danh sách */
  currentMemberId?: number | null;
}) {
  const t = useTranslations("voting");
  // Danh sách "Chưa vote" mặc định ĐÓNG (accordion) — buổi đông thì phần đã
  // vote là trọng tâm, danh sách chưa vote dài không chiếm chỗ.
  const [notVotedOpen, setNotVotedOpen] = useState(false);
  const voteMap = new Map(votes.map((v) => [v.memberId, v]));

  const votedMembers = members.filter((m) => {
    const v = voteMap.get(m.id);
    return v != null && !!(v.willPlay || v.willDine);
  });
  const votedSorted =
    currentMemberId != null
      ? [...votedMembers].sort((a, b) => {
          const aSelf = a.id === currentMemberId ? 0 : 1;
          const bSelf = b.id === currentMemberId ? 0 : 1;
          return aSelf - bSelf;
        })
      : votedMembers;
  const notVotedMembers = members.filter((m) => !voteMap.has(m.id));

  return (
    <div className="space-y-4">
      {votedSorted.length > 0 && (
        <div className="bg-background/60 dark:bg-background/40 ring-border/60 divide-border/60 divide-y overflow-hidden rounded-xl shadow-sm ring-1">
          <AnimatePresence initial={false}>
            {votedSorted.map((member) => {
              const vote = voteMap.get(member.id)!;
              return (
                <motion.div
                  key={member.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <MemberAvatar
                    memberId={member.id}
                    avatarKey={member.avatarKey}
                    avatarUrl={member.avatarUrl}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">
                      {member.name}
                      {member.nickname && (
                        <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                          ({member.nickname})
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {vote.willPlay && (
                        <Badge
                          variant="votePlay"
                          className="h-7 px-3 py-1 text-sm font-semibold"
                        >
                          🏸 {t("badmintonShort")}
                          {(vote.guestPlayCount ?? 0) > 0 &&
                            ` ${t("plusGuest", { count: vote.guestPlayCount ?? 0 })}`}
                        </Badge>
                      )}
                      {vote.willDine && (
                        <Badge
                          variant="voteDine"
                          className="h-7 px-3 py-1 text-sm font-semibold"
                        >
                          🍻 {t("diningShort")}
                          {(vote.guestDineCount ?? 0) > 0 &&
                            ` ${t("plusGuest", { count: vote.guestDineCount ?? 0 })}`}
                        </Badge>
                      )}
                      {/* Đi 2 người → 1 chip gọn "👫 +2" (badge Cầu/Nhậu giữ sạch). */}
                      {vote.withPartner && (vote.willPlay || vote.willDine) && (
                        <span className="border-primary/40 bg-primary/10 text-primary inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-sm font-semibold">
                          👫 +2
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {notVotedMembers.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setNotVotedOpen((v) => !v)}
            aria-expanded={notVotedOpen}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-muted-foreground text-base font-semibold tracking-wider uppercase">
              {t("notVoted")} ({notVotedMembers.length})
            </span>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-5 w-5 shrink-0 transition-transform",
                notVotedOpen && "rotate-180",
              )}
            />
          </button>
          <AnimatePresence initial={false}>
            {notVotedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-background/60 dark:bg-background/40 ring-border/60 divide-border/60 divide-y overflow-hidden rounded-xl shadow-sm ring-1">
                  {notVotedMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 px-3 py-2 opacity-60"
                    >
                      <MemberAvatar
                        memberId={member.id}
                        avatarKey={member.avatarKey}
                        avatarUrl={member.avatarUrl}
                        size={40}
                      />
                      <p className="truncate text-base font-medium">
                        {member.name}
                        {member.nickname && (
                          <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                            ({member.nickname})
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {members.length === 0 && (
        <EmptyState icon={Users} title={t("noMembers")} />
      )}
    </div>
  );
}
