"use server";

import { db } from "@/db";
import { members, memberOauthIdentities } from "@/db/schema";
import { eq, and, ne, inArray, notExists, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getUserFromCookie, clearUserCookie } from "@/lib/user-identity";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTranslations } from "next-intl/server";
import { mergeMember } from "@/actions/members";
import { foldOAuthIntoTarget } from "@/lib/oauth-identity";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { requireExchangeMember } from "@/lib/member-auth";
import { isExchangeAccount } from "@/lib/exchange-account";
import {
  notifyGroupJoinRequest,
  notifyMemberAccount,
  repointNotifications,
} from "@/lib/notifications/account-events";
import { repointExchangeRows } from "@/lib/exchange/member-rows";
import { invalidateMemberReputation } from "@/lib/reputation/invalidate";

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
 * "Admin tạo" = approved member chưa có facebookId, chưa có googleId VÀ chưa có
 * identity Zalo → thường là row admin nhập tay vào quỹ. Đúng kịch bản user mô
 * tả: admin tạo sẵn "Nguyễn Văn A", giờ A signup → gợi ý merge.
 */
/** Một ứng viên trong pool để chấm điểm. Chỉ các field thật sự cần. */
type MatchPoolRow = {
  id: number;
  name: string;
  nickname: string | null;
  facebookId: string | null;
  googleId: string | null;
  passwordHash: string | null;
};

/**
 * Chấm điểm trùng tên. HÀM THUẦN, không đụng DB.
 *
 * Tách ra khỏi phần truy vấn để bản-một-người và bản-nhiều-người dùng CHUNG
 * đúng một cách tính. Trước đây chỉ có bản một người, và trang quản lý gọi nó
 * trong vòng lặp.
 */
function rankNameMatches(
  pending: { id: number; name: string; nickname: string | null },
  pool: MatchPoolRow[],
): NameMatchSuggestion[] {
  const pendingNorm = normalizeName(pending.name);
  const pendingNickNorm = pending.nickname
    ? normalizeName(pending.nickname)
    : "";

  return (
    pool
      .filter((m) => m.id !== pending.id)
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
      .slice(0, 5)
  );
}

/**
 * Pool ứng viên: member đã duyệt do admin tạo tay. Đọc MỘT LẦN rồi chấm cho
 * mọi pending.
 *
 * Pool = pool cũ trừ member có identity Zalo. Zalo không có cột legacy nên
 * thiếu vế này thì người đã vào nhóm bằng Zalo bị gợi ý như row nhập tay và
 * admin có thể gộp nhầm vào chính chủ. Chỉ loại theo `provider = 'zalo'`, KHÔNG
 * loại mọi identity: member admin tạo rồi tự liên kết Google qua /me hay được
 * gộp identity (foldOAuthIntoTarget) chỉ có dòng ở bảng identity, và họ vẫn
 * phải được gợi ý như trước đây.
 */
async function loadMatchPool(): Promise<MatchPoolRow[]> {
  return db.query.members.findMany({
    where: and(
      eq(members.approvalStatus, "approved"),
      notExists(
        db
          .select({ one: sql`1` })
          .from(memberOauthIdentities)
          .where(
            and(
              eq(memberOauthIdentities.memberId, members.id),
              eq(memberOauthIdentities.provider, "zalo"),
            ),
          ),
      ),
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
}

/**
 * Gợi ý trùng tên cho NHIỀU pending cùng lúc.
 *
 * Lý do tồn tại là chi phí đọc: bản một-người nạp lại TOÀN BỘ pool cho từng
 * pending, nên trang quản lý với 182 người chờ duyệt ngốn 380 truy vấn và hơn
 * 8.000 dòng đọc MỖI LẦN TẢI, mà màn đó còn tự tải lại mỗi vài giây. Đây là
 * thứ đã làm cháy hạn mức đọc của Turso ngày 24/10/2026 và sập cả web.
 * Bản này đọc đúng hai lần bất kể bao nhiêu người chờ.
 */
export async function getNameMatchesBatch(
  pendingMemberIds: number[],
): Promise<Record<number, NameMatchSuggestion[]>> {
  const auth = await requireAdmin();
  if ("error" in auth) return {};
  if (pendingMemberIds.length === 0) return {};

  const [pendings, pool] = await Promise.all([
    db.query.members.findMany({
      where: inArray(members.id, pendingMemberIds),
      columns: { id: true, name: true, nickname: true },
    }),
    loadMatchPool(),
  ]);

  const out: Record<number, NameMatchSuggestion[]> = {};
  for (const p of pendings) out[p.id] = rankNameMatches(p, pool);
  return out;
}

/**
 * Bản một người. Giữ lại cho chỗ gọi lẻ; trang quản lý dùng
 * `getNameMatchesBatch` vì nó có cả danh sách.
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

  return rankNameMatches(pending, await loadMatchPool());
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

  // bankAccountNo là cột UNIQUE. Form này TỒN TẠI để pending user nhập đúng số
  // TK khớp với row admin đã tạo sẵn cho họ → số đó nhiều khả năng ĐÃ nằm trên
  // member khác. Ghi thẳng sẽ vỡ UNIQUE và ném lỗi thô. Nếu số đã thuộc member
  // khác thì bỏ qua trường bank (nickname/phone vẫn lưu); admin sẽ gộp/khớp sau.
  let bankToWrite = bankAccountNo;
  if (bankAccountNo) {
    const bankOwner = await db.query.members.findFirst({
      where: and(
        eq(members.bankAccountNo, bankAccountNo),
        ne(members.id, member.id),
      ),
      columns: { id: true },
    });
    if (bankOwner) bankToWrite = null;
  }

  await db
    .update(members)
    .set({ nickname, phoneNumber, bankAccountNo: bankToWrite })
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
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(members)
      .set({
        approvalStatus: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: adminId,
      })
      .where(
        and(eq(members.id, memberId), ne(members.approvalStatus, "approved")),
      )
      .returning({ id: members.id });
    if (changed.length > 0) {
      await notifyMemberAccount(tx, {
        kind: "account_approved",
        memberId,
        dedupBase: `acct:approve:m${memberId}`,
      });
    }
  });
  await invalidateMemberReputation(db, [memberId], { asRater: true });

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
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(members)
      .set({
        approvalStatus: "rejected",
        approvedAt: new Date().toISOString(),
        approvedBy: adminId,
      })
      .where(
        and(eq(members.id, memberId), ne(members.approvalStatus, "rejected")),
      )
      .returning({ id: members.id });
    if (changed.length > 0) {
      await notifyMemberAccount(tx, {
        kind: "account_rejected",
        memberId,
        dedupBase: `acct:reject:m${memberId}`,
      });
    }
  });
  await invalidateMemberReputation(db, [memberId], { asRater: true });

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
  // Tài khoản giao lưu chưa xin vào nhóm: gộp nó (hay gộp vào nó) sẽ duyệt
  // ngầm một người chưa hề xin vào nhóm.
  if (isExchangeAccount(pending) || isExchangeAccount(target)) {
    return { error: "Không gộp được tài khoản giao lưu" };
  }
  // Multi-SSO: CHO PHÉP merge kể cả khi cả pending lẫn target đều đã có OAuth
  // cùng loại (vd 2 tài khoản Google). Tài khoản OAuth của pending được gộp
  // thành identity PHỤ của target (foldOAuthIntoTarget trong tx) → target đăng
  // nhập được bằng cả 2. Trước đây guard chặn case này khiến nút gộp "không
  // làm gì" khi cả 2 có Google. Admin tự xác nhận đây là cùng 1 người.

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
    // Reset mật khẩu cũ của target nếu có: sau merge chỉ nên còn đường đăng
    // nhập qua OAuth (target + identity vừa gộp). Tránh trường hợp mật khẩu cũ
    // do người khác đặt (claim email) vẫn dùng được song song với OAuth mới.
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

    // Gộp tài khoản đăng nhập của pending vào target (re-point identity rows +
    // tạo identity cho OAuth legacy của pending) TRƯỚC khi xóa pending — target
    // đăng nhập được bằng cả OAuth của pending. Dùng giá trị legacy gốc của
    // pending (object fetch trước tx, không bị ảnh hưởng bởi bước NULL ở trên).
    await foldOAuthIntoTarget(tx, pendingMemberId, targetMemberId, {
      googleId: pending.googleId,
      facebookId: pending.facebookId,
      email: pending.email,
    });

    // Delete pending row. Pending chưa có debt/vote/attendee/etc nào (mới
    // signup) → hard delete safe. Phòng trường hợp họ đã vote ngay, dùng
    // mergeMember pattern sẽ an toàn hơn — nhưng pending users đáng lẽ bị
    // gate khỏi vote, nên hard delete OK.
    // Tin đã gửi cho tài khoản chờ duyệt chuyển sang target trước khi xoá nó.
    await repointNotifications(tx, pendingMemberId, targetMemberId);
    await repointExchangeRows(tx, pendingMemberId, targetMemberId);
    await tx.delete(members).where(eq(members.id, pendingMemberId));

    await notifyMemberAccount(tx, {
      kind: "account_merged",
      memberId: targetMemberId,
      dedupBase: `acct:merge:m${targetMemberId}`,
    });
  });
  await invalidateMemberReputation(db, [pendingMemberId, targetMemberId], {
    asRater: true,
    codes: true,
  });

  revalidatePath("/admin/members");
  revalidatePath("/pending-approval");
  revalidatePath("/");
  return { success: true };
}

/**
 * Admin không nhận một yêu cầu vào nhóm: trả tài khoản về "giao lưu"
 * (`signupIntent = "exchange"`) mà KHÔNG cấm. Khác `rejectMember` (cấm hẳn).
 * Người đó vẫn đăng nhập và dùng phần giao lưu, và có thể xin lại sau.
 *
 * Chỉ nhận dòng pending + group + còn hoạt động; WHERE lặp lại các điều kiện
 * đó nên nếu admin khác vừa duyệt/khoá giữa chừng thì không ghi đè trạng thái.
 */
export async function declineGroupRequest(
  memberId: number,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  // Hành vi mới của giao lưu: cờ tắt thì không được ghi (nút cũng ẩn ở UI, nhưng
  // server action gọi thẳng được nên phải chặn ở đây).
  if (!(await isExchangeEnabled())) return { error: "Tính năng chưa mở" };
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return { error: t("invalidId") };
  }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(members)
      .set({ signupIntent: "exchange" })
      .where(
        and(
          eq(members.id, memberId),
          eq(members.approvalStatus, "pending"),
          eq(members.signupIntent, "group"),
          eq(members.isActive, true),
        ),
      )
      .returning({ id: members.id });
    if (rows.length > 0) {
      await notifyMemberAccount(tx, {
        kind: "group_request_declined",
        memberId,
        dedupBase: `acct:decline:m${memberId}`,
      });
    }
    return rows;
  });
  if (updated.length === 0) {
    return {
      error: "Chỉ nhận được yêu cầu đang chờ duyệt của member đang hoạt động",
    };
  }

  revalidatePath("/admin/members");
  revalidatePath("/exchanges");
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

/**
 * Tài khoản giao lưu xin vào nhóm: đổi `signupIntent` "exchange" → "group" để
 * member hiện trong hàng chờ của admin. KHÔNG duyệt ai (vẫn `pending`) và
 * không đụng người đã vào nhóm, nên gọi lại hay gọi trên tài khoản đã duyệt
 * đều trả success mà không ghi.
 */
export async function requestGroupMembership(): Promise<
  { success: true } | { error: string }
> {
  if (!(await isExchangeEnabled())) return { error: "Tính năng chưa mở" };

  const auth = await requireExchangeMember();
  if ("error" in auth) return auth;
  const { member } = auth;

  // Cùng kiểu với updatePendingProfile: người chờ duyệt không được ghi không
  // giới hạn (mỗi lần ghi còn xoá cache trang admin).
  const rl = await checkRateLimit(`join-group:${member.id}`, 10, 60_000);
  if (!rl.ok) return { error: "Thao tác quá nhanh, thử lại sau." };

  if (member.approvalStatus !== "pending") return { success: true };
  if (member.signupIntent === "group") return { success: true };

  // WHERE lặp lại điều kiện đã đọc: nếu admin vừa duyệt/từ chối giữa chừng thì
  // câu lệnh không khớp dòng nào thay vì ghi đè trạng thái mới.
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(members)
      .set({ signupIntent: "group" })
      .where(
        and(eq(members.id, member.id), eq(members.approvalStatus, "pending")),
      )
      .returning({ id: members.id });
    if (changed.length > 0) await notifyGroupJoinRequest(tx, member.id);
  });

  revalidatePath("/admin/members");
  revalidatePath("/exchanges");
  revalidatePath("/");
  return { success: true };
}
