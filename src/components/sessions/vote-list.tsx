"use client";

import { MemberAvatar } from "@/components/shared/member-avatar";
import { Badge } from "@/components/ui/badge";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};

type Member = InferSelectModel<typeof membersTable>;

export function VoteList({
  votes,
  members,
}: {
  votes: Vote[];
  members: Member[];
}) {
  // Map of memberId -> vote
  const voteMap = new Map(votes.map((v) => [v.memberId, v]));

  // Split into voted and not-voted
  const votedMembers = members.filter((m) => voteMap.has(m.id));
  const notVotedMembers = members.filter((m) => !voteMap.has(m.id));

  return (
    <div className="space-y-4">
      {/* Members who voted */}
      {votedMembers.length > 0 && (
        <div className="space-y-2">
          {votedMembers.map((member) => {
            const vote = voteMap.get(member.id)!;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between py-2"
              >
                <div className="flex items-center gap-3">
                  <MemberAvatar memberId={member.id} size={32} />
                  <div>
                    <p className="font-medium text-sm">{member.name}</p>
                    <div className="flex gap-1 mt-0.5">
                      {vote.willPlay && (
                        <Badge variant="default" className="text-xs">
                          Choi
                        </Badge>
                      )}
                      {vote.willDine && (
                        <Badge variant="secondary" className="text-xs">
                          An
                        </Badge>
                      )}
                      {!vote.willPlay && !vote.willDine && (
                        <Badge variant="outline" className="text-xs">
                          Khong di
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {(vote.guestPlayCount ?? 0) > 0 && (
                    <p>+{vote.guestPlayCount} khach choi</p>
                  )}
                  {(vote.guestDineCount ?? 0) > 0 && (
                    <p>+{vote.guestDineCount} khach an</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Members who haven't voted */}
      {notVotedMembers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Chua vote ({notVotedMembers.length})
          </p>
          {notVotedMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 py-2 opacity-50"
            >
              <MemberAvatar memberId={member.id} size={32} />
              <p className="font-medium text-sm">{member.name}</p>
            </div>
          ))}
        </div>
      )}

      {members.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Chua co thanh vien nao
        </p>
      )}
    </div>
  );
}
