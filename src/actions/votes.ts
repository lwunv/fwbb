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

export async function getSessionVotes(sessionId: number) {
  return db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
    with: { member: true },
  });
}
