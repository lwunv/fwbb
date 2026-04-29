"use server";

import { db } from "@/db";
import { votes, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";
import { requireAdmin } from "@/lib/auth";
import { adminGuestCountSchema, voteSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";

export async function submitVote(
  sessionId: number,
  willPlay: boolean,
  willDine: boolean,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui long xac nhan danh tinh truoc" };

  // 60 vote-toggles per minute per member is plenty for normal use; spamming
  // the toggle (which writes to votes + revalidates) is rate-limited here.
  const rl = await checkRateLimit(`vote:${user.memberId}`, 60, 60_000);
  if (!rl.ok) {
    return { error: `Quá nhiều thao tác, thử lại sau ${rl.retryAfter ?? 60}s` };
  }

  const parsed = voteSchema.safeParse({
    sessionId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
  });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status !== "voting" && session.status !== "confirmed") {
    return { error: "Buổi chơi không còn nhận vote" };
  }

  await db
    .insert(votes)
    .values({
      sessionId: data.sessionId,
      memberId: user.memberId,
      willPlay: data.willPlay,
      willDine: data.willDine,
      guestPlayCount: data.guestPlayCount,
      guestDineCount: data.guestDineCount,
    })
    .onConflictDoUpdate({
      target: [votes.sessionId, votes.memberId],
      set: {
        willPlay: data.willPlay,
        willDine: data.willDine,
        guestPlayCount: data.guestPlayCount,
        guestDineCount: data.guestDineCount,
        updatedAt: new Date().toISOString(),
      },
    });

  revalidatePath("/");
  revalidatePath(`/vote/${data.sessionId}`);
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  return { success: true };
}

// Admin: add/update a member's vote
async function assertSessionAllowsVoteEdits(sessionId: number) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Không tìm thấy buổi" } as const;
  if (session.status !== "voting" && session.status !== "confirmed") {
    return { error: "Buổi không còn mở chỉnh sửa vote" } as const;
  }
  return { session } as const;
}

export async function adminSetVote(
  sessionId: number,
  memberId: number,
  willPlay: boolean,
  willDine: boolean,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  if (!Number.isInteger(sessionId) || sessionId <= 0)
    return { error: "sessionId không hợp lệ" };
  if (!Number.isInteger(memberId) || memberId <= 0)
    return { error: "memberId không hợp lệ" };

  const allow = await assertSessionAllowsVoteEdits(sessionId);
  if ("error" in allow) return allow;

  await db
    .insert(votes)
    .values({
      sessionId,
      memberId,
      willPlay,
      willDine,
      guestPlayCount: 0,
      guestDineCount: 0,
    })
    .onConflictDoUpdate({
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

// Admin: update guest counts for a member's vote
export async function adminSetGuestCount(
  sessionId: number,
  memberId: number,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = adminGuestCountSchema
    .pick({ guestPlayCount: true, guestDineCount: true })
    .safeParse({
      guestPlayCount,
      guestDineCount,
    });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Số khách không hợp lệ",
    };
  }

  const allow = await assertSessionAllowsVoteEdits(sessionId);
  if ("error" in allow) return allow;

  const existing = await db.query.votes.findFirst({
    where: (v, { and, eq: e }) =>
      and(e(v.sessionId, sessionId), e(v.memberId, memberId)),
  });
  if (!existing) return { error: "Vote not found" };

  await db
    .update(votes)
    .set({
      guestPlayCount: parsed.data.guestPlayCount,
      guestDineCount: parsed.data.guestDineCount,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(votes.id, existing.id));

  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/");
  return { success: true };
}

// Admin: remove a member's vote entirely
export async function adminRemoveVote(sessionId: number, memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const allow = await assertSessionAllowsVoteEdits(sessionId);
  if ("error" in allow) return allow;

  const existing = await db.query.votes.findFirst({
    where: (v, { and, eq }) =>
      and(eq(v.sessionId, sessionId), eq(v.memberId, memberId)),
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
