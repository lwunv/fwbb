"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
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
          {votedSorted.map((member) => {
            const vote = voteMap.get(member.id)!;
            return (
              <div key={member.id} className="flex items-center gap-3 py-2">
                <MemberAvatar memberId={member.id} avatarKey={member.avatarKey} avatarUrl={member.avatarUrl} size={32} />
                <div>
                  <p className="font-medium text-sm">{member.name}</p>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {vote.willPlay && (
                      <Badge variant="votePlay" className="text-xs">
                        🏸 {t("badmintonShort")}
                      </Badge>
                    )}
                    {vote.willDine && (
                      <Badge variant="voteDine" className="text-xs">
                        🍻 {t("diningShort")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notVotedMembers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            {t("notVoted")} ({notVotedMembers.length})
          </p>
          {notVotedMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 py-2 opacity-50"
            >
              <MemberAvatar memberId={member.id} avatarKey={member.avatarKey} avatarUrl={member.avatarUrl} size={32} />
              <p className="font-medium text-sm">{member.name}</p>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("noMembers")}
        </p>
      )}
    </div>
  );
}
