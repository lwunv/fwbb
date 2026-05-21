"use server";

import { db } from "@/db";
import { votes, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/member-auth";
import { requireAdmin } from "@/lib/auth";
import { adminGuestCountSchema, voteSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertEditable, type SessionStatus } from "@/lib/session-status";
import { getTranslations } from "next-intl/server";

export async function submitVote(
  sessionId: number,
  willPlay: boolean,
  willDine: boolean,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const t = await getTranslations("serverErrors");
  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  // 60 vote-toggles per minute per member is plenty for normal use; spamming
  // the toggle (which writes to votes + revalidates) is rate-limited here.
  const rl = await checkRateLimit(`vote:${user.memberId}`, 60, 60_000);
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const parsed = voteSchema.safeParse({
    sessionId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
  });
  if (!session) return { error: t("sessionNotFound") };
  if (session.status !== "voting" && session.status !== "confirmed") {
    return { error: t("voteNotAccepted") };
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

// Admin: add/update a member's vote — guard editable status với
// `assertEditable` (cùng helper với cost-affecting actions để error message
// nhất quán + hint admin bấm "Mở lại").
async function assertSessionAllowsVoteEdits(sessionId: number) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) {
    const t = await getTranslations("serverErrors");
    return { error: t("sessionNotFoundShort") } as const;
  }
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error } as const;
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

  const t = await getTranslations("serverErrors");
  if (!Number.isInteger(sessionId) || sessionId <= 0)
    return { error: t("invalidSessionId") };
  if (!Number.isInteger(memberId) || memberId <= 0)
    return { error: t("invalidMemberId") };

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
    const t = await getTranslations("serverErrors");
    return {
      error: parsed.error.issues[0]?.message ?? t("invalidQuantity"),
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

/** Trả về votes kèm member — REDACT PII (email/bankAccountNo/facebookId)
 *  trước khi serialize về client. Hàm gọi từ cả public pages (home, /vote/:id)
 *  lẫn admin pages; redact ngay tại nguồn để tránh leak qua RSC payload bất
 *  kỳ caller nào. Admin nếu cần PII thật phải đi qua action admin-only riêng. */
export async function getSessionVotes(sessionId: number) {
  const rows = await db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
    with: { member: true },
  });
  return rows.map((v) => ({
    ...v,
    member: {
      ...v.member,
      email: null,
      bankAccountNo: null,
      facebookId: "",
    },
  }));
}
