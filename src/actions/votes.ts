"use server";

import { db } from "@/db";
import { votes, sessions } from "@/db/schema";
import {
  PUBLIC_MEMBER_COLUMNS,
  type VoteWithMember,
} from "@/lib/optimistic-votes";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireApprovedMember } from "@/lib/member-auth";
import { requireAdmin } from "@/lib/auth";
import { adminGuestCountSchema, voteSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  MAX_PLAY_SLOTS,
  playHeadcount,
  votePlayContribution,
} from "@/lib/vote-capacity";
import {
  assertEditable,
  isVoteOpen,
  type SessionStatus,
} from "@/lib/session-status";
import { getTranslations } from "next-intl/server";

export async function submitVote(
  sessionId: number,
  willPlay: boolean,
  willDine: boolean,
  guestPlayCount: number,
  guestDineCount: number,
  withPartner: boolean,
) {
  const t = await getTranslations("serverErrors");
  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };
  const { user } = auth;

  const parsed = voteSchema.safeParse({
    sessionId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
    withPartner,
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
  const gate = isVoteOpen({
    status: session.status as SessionStatus,
    voteDeadline: session.voteDeadline,
  });
  if (!gate.open) {
    return {
      error:
        gate.reason === "deadline"
          ? t("voteDeadlinePassed")
          : t("voteNotAccepted"),
    };
  }

  // Rate-limit SAU validation + gate: chỉ đếm attempt hợp lệ thật sự đi tới
  // mutation. Trước đây increment ngay đầu → call bị reject (input sai / session
  // đóng / quá deadline) cũng đốt budget 60/phút và có thể tự khóa member.
  const rl = await checkRateLimit(`vote:${user.memberId}`, 60, 60_000);
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  // Khách của member đã BỎ (2026-07-07) — giờ chỉ admin thêm khách. Ép 0 ở
  // server (guestPlay/DineCount trong `data` bị bỏ qua) để member không set
  // khách qua RPC dù client không còn UI.

  // Giới hạn sức chứa CHƠI CẦU (MAX_PLAY_SLOTS). Chỉ CHẶN khi member TĂNG số
  // đầu chơi vượt sức chứa; vẫn cho bỏ vote / giảm / đổi sang nhậu / giữ nguyên
  // (member đang có slot không bị đá ra kể cả khi admin đã override quá số).
  const allVotes = await db.query.votes.findMany({
    where: eq(votes.sessionId, data.sessionId),
    with: { member: { columns: { isActive: true, approvalStatus: true } } },
  });
  // Locked / unapproved members are SKIPPED at finalize (finance.ts buildAttendees
  // continues past them), so their stale willPlay rows must NOT count toward the
  // capacity divisor here — otherwise an active member is wrongly blocked with
  // "Hết slot" for a slot that finalize would leave empty.
  const countableVotes = allVotes.filter(
    (v) =>
      v.member && v.member.isActive && v.member.approvalStatus === "approved",
  );
  const others = countableVotes.filter((v) => v.memberId !== user.memberId);
  const selfVote = allVotes.find((v) => v.memberId === user.memberId);
  const base = playHeadcount(others, session.adminGuestPlayCount ?? 0);
  const existingMine = selfVote ? votePlayContribution(selfVote) : 0;
  const newMine = votePlayContribution({
    willPlay: data.willPlay,
    withPartner: data.withPartner,
  });
  const maxSlots = session.maxPlayers ?? MAX_PLAY_SLOTS;
  if (newMine > existingMine && base + newMine > maxSlots) {
    return { error: t("playSlotsFull", { max: maxSlots }) };
  }

  await db
    .insert(votes)
    .values({
      sessionId: data.sessionId,
      memberId: user.memberId,
      willPlay: data.willPlay,
      willDine: data.willDine,
      guestPlayCount: 0,
      guestDineCount: 0,
      withPartner: data.withPartner,
    })
    .onConflictDoUpdate({
      target: [votes.sessionId, votes.memberId],
      set: {
        willPlay: data.willPlay,
        willDine: data.willDine,
        guestPlayCount: 0,
        guestDineCount: 0,
        withPartner: data.withPartner,
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
  // Validate booleans — server actions là RPC-callable, giá trị runtime là thứ
  // caller serialize (project rule: validate trước khi ghi DB).
  if (typeof willPlay !== "boolean" || typeof willDine !== "boolean")
    return { error: t("invalidData", { detail: "willPlay/willDine" }) };

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
        // Atomically drop guests for a flag turned OFF — một member không
        // chơi/nhậu thì không thể có khách chơi/nhậu. Làm ở ĐÂY (thay vì client
        // gọi thêm adminSetGuestCount riêng) để bỏ desync: trước đây 2 request
        // độc lập, nếu 1 cái fail thì finalize vẫn tính "ghost guest". finalize
        // (buildAttendees) tạo guest theo guestPlayCount/DineCount không phụ
        // thuộc willPlay/willDine nên phải zero ở đây mới thật sự không tính.
        ...(willPlay ? {} : { guestPlayCount: 0 }),
        ...(willDine ? {} : { guestDineCount: 0 }),
        updatedAt: new Date().toISOString(),
      },
    });

  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/");
  return { success: true };
}

// Admin: bật/tắt "đi 2 người" (withPartner) cho vote của 1 member. withPartner
// đổi headcount 1↔2 → đổi mẫu số chia đầu người + phần chính member tự trả (đúng
// field finalize dùng: finance.ts headcount = withPartner ? 2 : 1). Chỉ hợp lệ
// khi member đã có vote row. KHÔNG enforce cap sức chứa — admin được override,
// giống adminSetVote (member đang có slot không bị đá ra dù admin vượt số).
export async function adminSetPartner(
  sessionId: number,
  memberId: number,
  withPartner: boolean,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  if (!Number.isInteger(sessionId) || sessionId <= 0)
    return { error: t("invalidSessionId") };
  if (!Number.isInteger(memberId) || memberId <= 0)
    return { error: t("invalidMemberId") };
  if (typeof withPartner !== "boolean")
    return { error: t("invalidData", { detail: "withPartner" }) };

  const allow = await assertSessionAllowsVoteEdits(sessionId);
  if ("error" in allow) return allow;

  const existing = await db.query.votes.findFirst({
    where: (v, { and, eq: e }) =>
      and(e(v.sessionId, sessionId), e(v.memberId, memberId)),
  });
  if (!existing) return { error: "Vote not found" };

  await db
    .update(votes)
    .set({ withPartner, updatedAt: new Date().toISOString() })
    .where(eq(votes.id, existing.id));

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

/** Trả về votes kèm member — WHITELIST cột an toàn ngay tại tầng query. Hàm gọi
 *  từ cả public pages (home, /vote/:id) lẫn admin pages → payload serialize tới
 *  MỌI khách vô danh. Dùng `PUBLIC_MEMBER_COLUMNS` (whitelist) nên secret/PII
 *  (email/phone/bank/fb/google/passwordHash) KHÔNG bao giờ rời DB. Cột nhạy cảm
 *  MỚI thêm vào members tự động bị loại (vắng khỏi whitelist) — không còn phải
 *  nhớ blacklist. Admin cần PII thật phải đi qua action admin-only riêng. */
export async function getSessionVotes(
  sessionId: number,
): Promise<VoteWithMember[]> {
  return db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
    with: { member: { columns: PUBLIC_MEMBER_COLUMNS } },
  });
}
