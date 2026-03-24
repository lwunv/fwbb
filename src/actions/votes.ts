"use server";

import { db } from "@/db";
import { votes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";

export async function submitVote(
  sessionId: number,
  willPlay: boolean,
  willDine: boolean,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui long xac nhan danh tinh truoc" };

  await db.insert(votes).values({
    sessionId,
    memberId: user.memberId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
  }).onConflictDoUpdate({
    target: [votes.sessionId, votes.memberId],
    set: {
      willPlay,
      willDine,
      guestPlayCount,
      guestDineCount,
      updatedAt: new Date().toISOString(),
    },
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

// Admin: add/update a member's vote
export async function adminSetVote(
  sessionId: number,
  memberId: number,
  willPlay: boolean,
  willDine: boolean,
) {
  await db.insert(votes).values({
    sessionId,
    memberId,
    willPlay,
    willDine,
    guestPlayCount: 0,
    guestDineCount: 0,
  }).onConflictDoUpdate({
    target: [votes.sessionId, votes.memberId],
    set: {
      willPlay,
      willDine,
      updatedAt: new Date().toISOString(),
    },
  });

  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/");
  return { success: true };
}

// Admin: remove a member's vote entirely
export async function adminRemoveVote(sessionId: number, memberId: number) {
  const existing = await db.query.votes.findFirst({
    where: (v, { and, eq }) => and(eq(v.sessionId, sessionId), eq(v.memberId, memberId)),
  });
  if (existing) {
    await db.delete(votes).where(eq(votes.id, existing.id));
  }
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/");
  return { success: true };
}

export async function getSessionVotes(sessionId: number) {
  return db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
    with: { member: true },
  });
}
