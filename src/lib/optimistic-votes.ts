import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

export type VoteWithMember = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};

export type VoteTotalsPatch = {
  willPlay: boolean;
  willDine: boolean;
  guestPlayCount: number;
  guestDineCount: number;
};

/** Cập nhật / thêm một dòng vote cục bộ (optimistic), giữ nguyên object các dòng khác khi có thể */
export function applyMemberVotePatch(
  votes: VoteWithMember[],
  sessionId: number,
  members: InferSelectModel<typeof membersTable>[],
  memberId: number,
  patch: VoteTotalsPatch,
): VoteWithMember[] {
  const i = votes.findIndex((v) => v.memberId === memberId);
  if (i >= 0) {
    const next = [...votes];
    next[i] = { ...next[i], ...patch };
    return next;
  }
  const member = members.find((m) => m.id === memberId);
  if (!member) return votes;
  const now = new Date().toISOString();
  return [
    ...votes,
    {
      id: 0,
      sessionId,
      memberId,
      willPlay: patch.willPlay,
      willDine: patch.willDine,
      guestPlayCount: patch.guestPlayCount,
      guestDineCount: patch.guestDineCount,
      createdAt: now,
      updatedAt: now,
      member,
    } satisfies VoteWithMember,
  ];
}
