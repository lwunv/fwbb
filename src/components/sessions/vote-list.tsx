"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/empty-state";
import { Users } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
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
        <div className="space-y-2">
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
                  className="flex items-center gap-3 py-2.5"
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
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {vote.willPlay && (
                        <Badge
                          variant="votePlay"
                          className="h-7 px-3 py-1 text-sm font-semibold"
                        >
                          🏸 {t("badmintonShort")}
                        </Badge>
                      )}
                      {vote.willDine && (
                        <Badge
                          variant="voteDine"
                          className="h-7 px-3 py-1 text-sm font-semibold"
                        >
                          🍻 {t("diningShort")}
                        </Badge>
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
          <p className="text-muted-foreground text-base font-semibold tracking-wider uppercase">
            {t("notVoted")} ({notVotedMembers.length})
          </p>
          <AnimatePresence initial={false}>
            {notVotedMembers.map((member) => (
              <motion.div
                key={member.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 py-2"
              >
                <MemberAvatar
                  memberId={member.id}
                  avatarKey={member.avatarKey}
                  avatarUrl={member.avatarUrl}
                  size={40}
                />
                <p className="truncate text-base font-medium">{member.name}</p>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {members.length === 0 && (
        <EmptyState icon={Users} title={t("noMembers")} />
      )}
    </div>
  );
}
