import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

/**
 * SECURITY: member fields safe to ship in PUBLIC RSC payloads (home, /vote/:id).
 * `getSessionVotes` whitelists exactly these columns at the DB query level, so
 * secrets/PII (email, phone, bank, facebookId, googleId, passwordHash) are NEVER
 * fetched — let alone serialized. A new sensitive column added to `members` is
 * absent here by default (whitelist, not blacklist), so it can't leak unless
 * deliberately added. Keep this in sync with `PUBLIC_MEMBER_COLUMNS`.
 */
export type PublicMember = Pick<
  Member,
  "id" | "name" | "nickname" | "avatarKey" | "avatarUrl" | "isActive"
>;

/** Drizzle `columns` projection matching `PublicMember` — single source so the
 *  type and the query can't drift. */
export const PUBLIC_MEMBER_COLUMNS = {
  id: true,
  name: true,
  nickname: true,
  avatarKey: true,
  avatarUrl: true,
  isActive: true,
} as const;

export type VoteWithMember = InferSelectModel<typeof votesTable> & {
  member: PublicMember;
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
      // Only the public-safe fields (matches getSessionVotes' whitelist) — never
      // copy PII from the full member row into the optimistic client payload.
      member: {
        id: member.id,
        name: member.name,
        nickname: member.nickname,
        avatarKey: member.avatarKey,
        avatarUrl: member.avatarUrl,
        isActive: member.isActive,
      },
    } satisfies VoteWithMember,
  ];
}
