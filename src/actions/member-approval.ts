"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getUserFromCookie, clearUserCookie } from "@/lib/user-identity";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslations } from "next-intl/server";
import { mergeMember } from "@/actions/members";

/** Helper: normalize Vietnamese name for fuzzy matching (lowercase + strip
 *  diacritics + collapse whitespace). Đủ cho UX gợi ý, không phải search engine. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance — small impl đủ cho dataset member (< 200 rows).
 *  Trả về `0` = identical, càng cao càng khác. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

export interface NameMatchSuggestion {
  memberId: number;
  name: string;
  nickname: string | null;
  /** 0..1 similarity score. 1 = perfect, 0 = totally different. */
  score: number;
  /** Target đã có mật khẩu riêng — approveAndMergeMember sẽ CHẶN merge (chống
   *  chiếm tài khoản, xem guard trong hàm đó). UI phải disable + giải thích
   *  ngay tại đây, không để admin bấm rồi mới thấy toast lỗi. */
  hasPassword: boolean;
}

/**
 * Tìm top suggestions từ pool admin-tạo (đã approved, chưa link OAuth).
 *
 * "Admin tạo" = approved member chưa có facebookId AND chưa có googleId →
 * thường là row admin nhập tay vào quỹ. Đúng kịch bản user mô tả: admin tạo
 * sẵn "Nguyễn Văn A", giờ A signup → gợi ý merge.
 */
export async function getNameMatches(
  pendingMemberId: number,
): Promise<NameMatchSuggestion[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const pending = await db.query.members.findFirst({
    where: eq(members.id, pendingMemberId),
    columns: { id: true, name: true, nickname: true },
  });
  if (!pending) return [];

  const pool = await db.query.members.findMany({
    where: and(
      eq(members.approvalStatus, "approved"),
      ne(members.id, pendingMemberId),
    ),
    columns: {
      id: true,
      name: true,
      nickname: true,
      facebookId: true,
      googleId: true,
      passwordHash: true,
    },
  });

  const pendingNorm = normalizeName(pending.name);
  const pendingNickNorm = pending.nickname
    ? normalizeName(pending.nickname)
    : "";

  const scored = pool
    // Ưu tiên row chưa link OAuth (admin tạo). Row đã link là chính chủ đã
    // login trước đó → không phải gợi ý merge.
    .filter((m) => !m.facebookId && !m.googleId)
    .map((m) => {
      const a = normalizeName(m.name);
      const b = m.nickname ? normalizeName(m.nickname) : "";
      // 4 chiều so sánh + token-set (cùng từ nhưng đổi thứ tự).
      const scoreNameName = scoreSimilarity(pendingNorm, a);
      const scoreNickName = pendingNickNorm
        ? scoreSimilarity(pendingNickNorm, a)
        : 0;
      const scoreNameNick = b ? scoreSimilarity(pendingNorm, b) : 0;
      const scoreNickNick =
        pendingNickNorm && b ? scoreSimilarity(pendingNickNorm, b) : 0;
      // Token-set: "Hữu Nguyễn" vs "Nguyễn Hữu" → cùng tokens, score = 1.
      const scoreTokenSet = scoreTokenSetSimilarity(pendingNorm, a);
      const score = Math.max(
        scoreNameName,
        scoreNickName,
        scoreNameNick,
        scoreNickNick,
        scoreTokenSet,
      );
      return {
        memberId: m.id,
        name: m.name,
        nickname: m.nickname,
        score,
        hasPassword: !!m.passwordHash,
      };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored;
}

/**
 * Token-set similarity: tokenize cả 2, so sánh sorted token sequences.
 * "le huu" + "huu le" → cả 2 thành "huu le" → score 1.
 * Đặc biệt hữu ích cho tên Việt vì admin tạo tay có thể đảo thứ tự
 * "Họ Tên" vs OAuth provider trả "Tên Họ".
 */
function scoreTokenSetSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = a.split(/\s+/).filter(Boolean).sort().join(" ");
  const tb = b.split(/\s+/).filter(Boolean).sort().join(" ");
  if (!ta || !tb) return 0;
  return scoreSimilarity(ta, tb);
}

function scoreSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Substring contains gets a bonus.
  if (a.includes(b) || b.includes(a)) {
    const longer = Math.max(a.length, b.length);
    const shorter = Math.min(a.length, b.length);
    return 0.7 + 0.3 * (shorter / longer);
  }
  const dist = levenshtein(a, b);
  const longer = Math.max(a.length, b.length);
  return 1 - dist / longer;
}

/**
 * User-side: cập nhật profile khi đang ở trạng thái pending. Cho phép set
 * nickname / phoneNumber / bankAccountNo (tất cả optional). KHÔNG cho đổi
 * name (lấy từ OAuth provider).
 */
export async function updatePendingProfile(input: {
  nickname?: string | null;
  phoneNumber?: string | null;
  bankAccountNo?: string | null;
}) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Chưa đăng nhập" };

  // Rate limit (pending users get this unthrottled write+cache-purge otherwise).
  const rl = await checkRateLimit(
    `pending-profile:${user.memberId}`,
    20,
    60_000,
  );
  if (!rl.ok) return { error: "Thao tác quá nhanh, thử lại sau." };

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member) return { error: "Không tìm thấy member" };
  if (member.approvalStatus !== "pending") {
    return { error: "Tài khoản đã được duyệt, không thể sửa qua route này" };
  }

  const nickname =
    typeof input.nickname === "string" ? input.nickname.trim() || null : null;
  const phoneNumber =
    typeof input.phoneNumber === "string"
      ? input.phoneNumber.replace(/[^\d+]/g, "").slice(0, 20) || null
      : null;
  const bankAccountNo =
    typeof input.bankAccountNo === "string"
      ? input.bankAccountNo.replace(/[^\d]/g, "").slice(0, 32) || null
      : null;

  await db
    .update(members)
    .set({ nickname, phoneNumber, bankAccountNo })
    .where(eq(members.id, member.id));

  revalidatePath("/pending-approval");
  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Admin approve: set approvalStatus='approved' + ghi approvedAt + approvedBy.
 * Idempotent: gọi 2 lần không insert thêm.
 */
export async function approveMember(memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return { error: t("invalidId") };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) return { error: t("memberNotFound") };
  if (member.approvalStatus === "approved") return { success: true };

  const adminId = parseInt(String(auth.admin.sub), 10) || null;
  await db
    .update(members)
    .set({
      approvalStatus: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: adminId,
    })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  revalidatePath("/pending-approval");
  revalidatePath("/");
  return { success: true };
}

/**
 * Admin reject: set status='rejected'. User vẫn giữ row (audit), nhưng
 * không thể vào vote/play. Khi họ login lại, layout sẽ chặn.
 */
export async function rejectMember(memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return { error: t("invalidId") };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) return { error: t("memberNotFound") };

  const adminId = parseInt(String(auth.admin.sub), 10) || null;
  await db
    .update(members)
    .set({
      approvalStatus: "rejected",
      approvedAt: new Date().toISOString(),
      approvedBy: adminId,
    })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  revalidatePath("/pending-approval");
  return { success: true };
}

/**
 * Admin merge pending member vào existing approved member. Copy OAuth credentials
 * (facebookId/googleId/email/avatarUrl) sang target, set target = approved
 * (chắc chắn approved), rồi delete source pending member.
 *
 * Khác với `mergeMember` ở members.ts (xử lý debts/votes/ledger): ở đây source
 * là pending mới signup, chưa có debt/vote nào → đơn giản hơn rất nhiều.
 */
export async function approveAndMergeMember(
  pendingMemberId: number,
  targetMemberId: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(pendingMemberId) || !Number.isInteger(targetMemberId)) {
    return { error: t("invalidId") };
  }
  if (pendingMemberId === targetMemberId) {
    return { error: t("cannotMergeSelf") };
  }

  const [pending, target] = await Promise.all([
    db.query.members.findFirst({ where: eq(members.id, pendingMemberId) }),
    db.query.members.findFirst({ where: eq(members.id, targetMemberId) }),
  ]);
  if (!pending) return { error: t("memberNotFound") };
  if (!target) return { error: t("targetMemberNotFound") };
  if (pending.approvalStatus !== "pending") {
    return { error: "Chỉ merge được member đang pending" };
  }
  if (target.approvalStatus === "rejected") {
    return { error: "Target đã bị reject, không thể merge" };
  }
  // Target đã có mật khẩu riêng → CHO merge (quyết định 2026-07-06, admin chủ
  // động xác nhận đây đúng là cùng 1 người), nhưng PHẢI reset mật khẩu cũ
  // (set null ở updates dưới) — nếu không, người cũ vẫn đăng nhập được bằng
  // password cũ VÀ pending user giờ cũng login được qua OAuth mới gán =
  // 2 người cùng truy cập 1 tài khoản (chiếm tài khoản). Reset password buộc
  // chỉ còn 1 đường vào: OAuth vừa merge.
  if (
    (pending.facebookId && target.facebookId) ||
    (pending.googleId && target.googleId)
  ) {
    return {
      error:
        "Target đã có tài khoản OAuth riêng — không merge để tránh ghi đè/nhầm danh tính.",
    };
  }

  const adminId = parseInt(String(auth.admin.sub), 10) || null;

  // Copy OAuth credentials sang target, plus nickname/phone/bank nếu pending
  // có set mà target chưa có.
  await db.transaction(async (tx) => {
    const updates: Partial<typeof members.$inferInsert> = {
      approvalStatus: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: adminId,
    };
    if (pending.facebookId && !target.facebookId)
      updates.facebookId = pending.facebookId;
    if (pending.googleId && !target.googleId)
      updates.googleId = pending.googleId;
    if (pending.email && !target.email) updates.email = pending.email;
    if (pending.avatarUrl && !target.avatarUrl)
      updates.avatarUrl = pending.avatarUrl;
    if (pending.phoneNumber && !target.phoneNumber)
      updates.phoneNumber = pending.phoneNumber;
    if (pending.bankAccountNo && !target.bankAccountNo)
      updates.bankAccountNo = pending.bankAccountNo;
    if (pending.nickname && !target.nickname)
      updates.nickname = pending.nickname;
    // Reset mật khẩu cũ — xem giải thích ở guard phía trên. Từ giờ chỉ đăng
    // nhập được qua OAuth vừa merge (hoặc set lại mật khẩu mới sau này).
    if (target.passwordHash) updates.passwordHash = null;

    // Trước khi delete pending, clear UNIQUE fields để tránh collision với
    // target (cùng email/facebookId chẳng hạn).
    await tx
      .update(members)
      .set({
        facebookId: null,
        googleId: null,
        email: null,
        bankAccountNo: null,
      })
      .where(eq(members.id, pendingMemberId));

    await tx.update(members).set(updates).where(eq(members.id, targetMemberId));

    // Delete pending row. Pending chưa có debt/vote/attendee/etc nào (mới
    // signup) → hard delete safe. Phòng trường hợp họ đã vote ngay, dùng
    // mergeMember pattern sẽ an toàn hơn — nhưng pending users đáng lẽ bị
    // gate khỏi vote, nên hard delete OK.
    await tx.delete(members).where(eq(members.id, pendingMemberId));
  });

  revalidatePath("/admin/members");
  revalidatePath("/pending-approval");
  revalidatePath("/");
  return { success: true };
}

// Re-export mergeMember for completeness — admin có thể dùng cả 2 flows.
export { mergeMember };

/**
 * Logout cho user pending — clear cookie khi họ muốn signup bằng account khác.
 */
export async function pendingLogout() {
  await clearUserCookie();
  revalidatePath("/");
  return { success: true };
}
