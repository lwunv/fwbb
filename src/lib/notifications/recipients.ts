import { and, eq } from "drizzle-orm";
import { admins, members, votes } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { splitMembersByVote } from "@/lib/vote-list-utils";

export type Recipient = { type: "member" | "admin"; id: number };

const activeApproved = and(
  eq(members.isActive, true),
  eq(members.approvalStatus, "approved"),
);

export async function superadminRecipients(db: DbOrTx): Promise<Recipient[]> {
  const rows = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.role, "superadmin"));
  return rows.map((r) => ({ type: "admin", id: r.id }));
}

/** Member nhận tin nhóm: đang hoạt động và đã được duyệt. */
export async function groupMemberRecipients(db: DbOrTx): Promise<Recipient[]> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(activeApproved);
  return rows.map((r) => ({ type: "member", id: r.id }));
}

/**
 * Người nhận theo trạng thái vote của một buổi. "notVoted" gồm cả dòng vote cũ
 * false/false (member đã xoá vote), theo `splitMembersByVote`.
 */
export async function sessionVoteRecipients(
  db: DbOrTx,
  sessionId: number,
  which: "voted" | "notVoted" | "play",
): Promise<Recipient[]> {
  const [people, sessionVotes] = await Promise.all([
    db.select({ id: members.id }).from(members).where(activeApproved),
    db
      .select({
        memberId: votes.memberId,
        willPlay: votes.willPlay,
        willDine: votes.willDine,
      })
      .from(votes)
      .where(eq(votes.sessionId, sessionId)),
  ]);
  let picked: { id: number }[];
  if (which === "play") {
    const playing = new Set(
      sessionVotes.filter((v) => v.willPlay).map((v) => v.memberId),
    );
    picked = people.filter((p) => playing.has(p.id));
  } else {
    const split = splitMembersByVote(people, sessionVotes);
    picked = which === "voted" ? split.voted : split.notVoted;
  }
  return picked.map((p) => ({ type: "member", id: p.id }));
}

/** Nickname nếu có, không thì tên. Chỉ dùng cho tin gửi admin. */
export async function memberName(
  db: DbOrTx,
  memberId: number,
): Promise<string> {
  const [row] = await db
    .select({ name: members.name, nickname: members.nickname })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return row?.nickname || row?.name || "";
}
