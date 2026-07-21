"use server";

import bcrypt from "bcryptjs";
import { db } from "@/db";
import {
  members,
  votes,
  sessionAttendees,
  sessionDebts,
  financialTransactions,
  admins,
  memberOauthIdentities,
  sessionMinDeductionExemptions,
  paymentNotifications,
  dupIgnoredPairs,
  passwordResetTokens,
} from "@/db/schema";
import { eq, sql, or, ne, and, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { memberSchema } from "@/lib/validators";
import { normalizeUsername } from "@/lib/username";
import { AVATAR_BRAND_KEYS } from "@/lib/member-avatar-presets";
import { AVATAR_EMOJI_COUNT } from "@/lib/member-avatar-emoji";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import {
  foldOAuthIntoTarget,
  countLoginMethods,
  isUsablePassword,
} from "@/lib/oauth-identity";
import { sendInviteEmail } from "@/lib/mailer";
import {
  generateResetToken,
  inviteTokenExpiryIso,
} from "@/lib/password-reset-token";
import { z } from "zod";

export type UpdateMyProfileState = null | { success: true } | { error: string };

/**
 * Admin-only: member rows including admin-managed fields (facebookId, email,
 * bankAccountNo). Returns [] if caller is not admin.
 *
 * SECURITY: bcrypt `passwordHash` and `passwordResetExpiresAt` are NEVER shipped
 * to the client — the admin UI (MemberList) doesn't use them, and this list is
 * serialized into the RSC flight payload. We scrub them to null and expose only
 * a `hasPassword` boolean (used for the reset-password / merge-target hints).
 * Defense-in-depth even though the route is admin-gated.
 */
export async function getMembers() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  const rows = await db.query.members.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
  return rows.map((m) => ({
    ...m,
    passwordHash: null,
    passwordResetExpiresAt: null,
    hasPassword: !!m.passwordHash,
  }));
}

/**
 * Public-safe member list. Returns the full Member shape so existing component
 * prop types still resolve, but PII fields (facebookId / email / bankAccountNo)
 * are scrubbed at the action boundary. Admin pages should use `getMembers()`
 * for the real values.
 */
export async function getActiveMembers() {
  const rows = await db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (m, { asc }) => [asc(m.name)],
    // Do not load PII columns from the DB at all (public pickers / home / vote).
    columns: {
      id: true,
      name: true,
      nickname: true,
      avatarKey: true,
      avatarUrl: true,
      isActive: true,
      defaultWithPartner: true,
      createdAt: true,
    },
  });
  return rows.map((m) => ({
    ...m,
    facebookId: null,
    googleId: null,
    email: null,
    passwordHash: null,
    bankAccountNo: null,
    phoneNumber: null,
    username: null,
    passwordResetExpiresAt: null,
    mustChangePassword: false,
    approvalStatus: "approved" as const,
    approvedAt: null,
    approvedBy: null,
  }));
}

/**
 * Trùng tên member = bug hay gây nhầm lẫn trong danh sách quỹ/nợ. Chuẩn hóa
 * bằng `LOWER(TRIM(name))` để "Liên" / "  liên " / "LIÊN" coi là cùng tên.
 * `excludeId` để cho phép updateMember giữ nguyên tên cũ.
 */
async function isDuplicateName(name: string, excludeId?: number) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  const conds = [
    sql`lower(trim(${members.name})) = ${normalized}`,
    excludeId ? ne(members.id, excludeId) : undefined,
  ].filter(Boolean) as ReturnType<typeof sql>[];
  const dup = await db.query.members.findFirst({
    where: and(...conds),
    columns: { id: true },
  });
  return !!dup;
}

/**
 * Chuẩn hoá + validate username (login đa kênh): lowercase, 3-32 ký tự
 * [a-z0-9._], unique (trừ chính mình khi có `excludeId`). Rỗng → null (xoá).
 * Dùng chung cho admin createMember/updateMember và self-edit updateMyProfile.
 * Trả `code` để caller tự map sang message theo namespace của nó (serverErrors
 * cho admin, me cho self-edit).
 */
async function resolveUsername(
  raw: string,
  excludeId: number | null,
): Promise<{ value: string | null } | { code: "invalid" | "taken" }> {
  const fmt = normalizeUsername(raw);
  if ("code" in fmt) return fmt;
  if (fmt.value === null) return { value: null };
  const dup = await db.query.members.findFirst({
    where: excludeId
      ? and(eq(members.username, fmt.value), ne(members.id, excludeId))
      : eq(members.username, fmt.value),
    columns: { id: true },
  });
  if (dup) return { code: "taken" };
  return { value: fmt.value };
}

export async function createMember(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name)) {
    return {
      error: t("memberNameTaken", { name: parsed.data.name.trim() }),
    };
  }
  let username: string | null = null;
  if (formData.has("username")) {
    const u = await resolveUsername(
      String(formData.get("username") ?? ""),
      null,
    );
    if ("code" in u) {
      return {
        error: t(u.code === "invalid" ? "usernameInvalid" : "usernameTaken"),
      };
    }
    username = u.value;
  }
  // Email (optional): validate + lowercase + unique. Dùng để gửi mail mời /
  // quên mật khẩu sau này. Chỉ đụng khi form gửi field.
  let email: string | null = null;
  if (formData.has("email")) {
    const raw = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (raw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { error: t("emailInvalid") };
      }
      const dup = await db.query.members.findFirst({
        where: eq(members.email, raw),
        columns: { id: true },
      });
      if (dup) return { error: t("emailTaken") };
      email = raw;
    }
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  // KHÔNG set facebookId placeholder. Member admin tạo phải để facebookId +
  // googleId = NULL thì merge flow mới nhận diện được: getNameMatches lọc
  // `!facebookId && !googleId` (chỉ gợi ý row chưa link OAuth), và
  // approveAndMergeMember chỉ graft OAuth vào placeholder rỗng-credential.
  // Fake id `admin_<ts>_<rand>` cũ khiến row admin-tạo KHÔNG bao giờ được gợi ý
  // merge khi chính chủ signup (FB login tra theo id thật, không replace fake).
  // Member email+password cũng đã insert với facebookId NULL — đồng nhất.
  const defaultWithPartner = formData.get("withPartner") === "1";
  // username UNIQUE: pre-check ở trên có race window → bọc write, map lỗi
  // UNIQUE về message localized thay vì ném lỗi DB thô.
  let newMemberId: number;
  try {
    const [inserted] = await db
      .insert(members)
      .values({
        ...parsed.data,
        nickname,
        username,
        email,
        defaultWithPartner,
      })
      .returning({ id: members.id });
    newMemberId = inserted.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/username/i.test(msg)) return { error: t("usernameTaken") };
    if (/email/i.test(msg)) return { error: t("emailTaken") };
    throw e;
  }

  // Mail mời đặt mật khẩu (Task 4): chỉ khi có email VÀ admin tick checkbox.
  // Token insert được await inline (nhanh, cùng request); gửi mail qua after()
  // để round-trip SMTP không chặn response — lỗi mail KHÔNG được rollback
  // member vừa tạo (mailer.sendInviteEmail đã non-throwing, .catch() ở đây chỉ
  // để phòng hờ, mirror pattern issueTokenAndSend trong password-reset.ts).
  if (email && formData.get("sendInvite") === "1") {
    // Member đã insert xong ở trên. Bọc toàn bộ invite (token insert + mail) để
    // 1 lỗi DB hi hữu KHÔNG ném ra client làm admin tưởng tạo member thất bại
    // (rồi retry → "tên/email đã dùng"). Invite là best-effort; member vẫn tạo.
    try {
      const { rawToken, tokenHash } = generateResetToken();
      await db.insert(passwordResetTokens).values({
        memberId: newMemberId,
        tokenHash,
        expiresAt: inviteTokenExpiryIso(),
      });
      const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const setupUrl = `${base}/reset-password/${rawToken}`;
      after(() => {
        sendInviteEmail(email, setupUrl).catch((err) => {
          console.error("[Members] invite mail send failed:", err);
        });
      });
    } catch (err) {
      console.error("[Members] invite token insert failed:", err);
    }
  }

  revalidatePath("/admin/members");
  return { success: true };
}

const avatarBrandSchema = z.enum(AVATAR_BRAND_KEYS);
const avatarEmojiSchema = z
  .string()
  .regex(/^emoji:\d+$/)
  .refine((s) => {
    const n = parseInt(s.slice("emoji:".length), 10);
    return Number.isFinite(n) && n >= 0 && n < AVATAR_EMOJI_COUNT;
  });
const avatarStorageSchema = z.union([avatarBrandSchema, avatarEmojiSchema]);

export type UpdateMyAvatarState = { success: true } | { error: string };

/** Đặt avatar: hãng vợt, `emoji:n`, hoặc `null` = emoji tự động theo id */
export async function updateMyAvatar(
  avatarKey: string | null,
): Promise<UpdateMyAvatarState> {
  const t = await getTranslations("me");
  const user = await getUserFromCookie();
  if (!user) {
    return { error: t("profileNotSignedIn") };
  }
  // Rate limit: each call purges up to 9 cache paths → throttle cache-stampede
  // spam (key on the HMAC-signed, non-spoofable cookie memberId).
  const rl = await checkRateLimit(`profile:${user.memberId}`, 20, 60_000);
  if (!rl.ok) {
    const tErr = await getTranslations("serverErrors");
    return { error: tErr("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  let next: string | null = null;
  if (avatarKey !== null && avatarKey !== "") {
    const p = avatarStorageSchema.safeParse(avatarKey);
    if (!p.success) {
      return { error: t("profileInvalid") };
    }
    next = p.data;
  }

  await db
    .update(members)
    .set({ avatarKey: next })
    .where(eq(members.id, user.memberId));

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/my-debts");
  revalidatePath("/stats");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function updateMyProfile(
  _prev: UpdateMyProfileState,
  formData: FormData,
): Promise<UpdateMyProfileState> {
  const t = await getTranslations("me");
  const user = await getUserFromCookie();
  if (!user) {
    return { error: t("profileNotSignedIn") };
  }
  const rl = await checkRateLimit(`profile:${user.memberId}`, 20, 60_000);
  if (!rl.ok) {
    const tErr = await getTranslations("serverErrors");
    return { error: tErr("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const nicknameRaw = String(formData.get("nickname") ?? "").trim();

  if (nicknameRaw.length > 40) {
    return { error: t("nicknameTooLong") };
  }
  const nickname = nicknameRaw.length === 0 ? null : nicknameRaw;
  const defaultWithPartner = formData.get("withPartner") === "1";

  const setValues: Partial<typeof members.$inferInsert> = {
    nickname,
    defaultWithPartner,
  };

  // Username (login đa kênh): tùy chọn, lowercase, 3-32 ký tự [a-z0-9._],
  // unique (trừ chính mình). Chỉ đụng khi form gửi field. Dùng chung helper với
  // admin create/updateMember.
  if (formData.has("username")) {
    const u = await resolveUsername(
      String(formData.get("username") ?? ""),
      user.memberId,
    );
    if ("code" in u) {
      return {
        error: t(u.code === "invalid" ? "usernameInvalid" : "usernameTaken"),
      };
    }
    setValues.username = u.value;
  }

  // Số điện thoại: tùy chọn, chỉ giữ chữ số.
  if (formData.has("phoneNumber")) {
    const digits = String(formData.get("phoneNumber") ?? "").replace(
      /[^\d]/g,
      "",
    );
    setValues.phoneNumber = digits || null;
  }

  // Email: tùy chọn, validate + unique (trừ chính mình).
  if (formData.has("email")) {
    const raw = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (raw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { error: t("emailInvalid") };
      }
      const dup = await db.query.members.findFirst({
        where: and(eq(members.email, raw), ne(members.id, user.memberId)),
        columns: { id: true },
      });
      if (dup) return { error: t("emailTaken") };
      setValues.email = raw;
    } else {
      setValues.email = null;
    }
  }

  // username/email đều UNIQUE. Pre-check ở trên có race window (2 người claim
  // cùng lúc), nên bọc write: nếu dính UNIQUE, trả {error} localized thay vì
  // ném lỗi DB thô (React 19 action reject → toast 500 khó hiểu).
  try {
    await db
      .update(members)
      .set(setValues)
      .where(eq(members.id, user.memberId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/username/i.test(msg)) return { error: t("usernameTaken") };
    if (/email/i.test(msg)) return { error: t("emailTaken") };
    throw e; // lỗi khác không nuốt
  }

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/my-debts");
  return { success: true };
}

export async function updateMember(id: number, formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name, id)) {
    return {
      error: t("memberNameTaken", { name: parsed.data.name.trim() }),
    };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  // Chỉ đổi defaultWithPartner khi form CÓ gửi field (tránh nuke về false khi
  // sửa nhanh nickname không kèm field này).
  const setValues: Partial<typeof members.$inferInsert> = {
    ...parsed.data,
    nickname,
  };
  if (formData.has("withPartner")) {
    setValues.defaultWithPartner = formData.get("withPartner") === "1";
  }
  // Email/SĐT: chỉ đụng khi form CÓ gửi field (cùng pattern withPartner) —
  // dialog "Sửa thông tin" luôn gửi cả 2 (rỗng = xoá), còn các form khác
  // (vd inline nickname cũ) không gửi thì giữ nguyên giá trị hiện có.
  if (formData.has("email")) {
    // Lowercase như updateMyProfile / signup / login-lookup (email UNIQUE của
    // SQLite phân biệt hoa-thường). Nếu admin lưu "Nam@Gmail.com" thì login
    // bằng email (đã hạ lowercase) không khớp, và có thể tạo email trùng khác
    // hoa-thường.
    const emailRaw =
      (formData.get("email") as string)?.trim().toLowerCase() || "";
    if (emailRaw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
        return { error: "Email không hợp lệ" };
      }
      const dup = await db.query.members.findFirst({
        where: and(eq(members.email, emailRaw), ne(members.id, id)),
        columns: { id: true },
      });
      if (dup) {
        return { error: "Email này đã được dùng bởi thành viên khác" };
      }
      setValues.email = emailRaw;
    } else {
      setValues.email = null;
    }
  }
  if (formData.has("phoneNumber")) {
    const phoneRaw = (formData.get("phoneNumber") as string)?.trim() || "";
    setValues.phoneNumber = phoneRaw || null;
  }
  if (formData.has("username")) {
    const u = await resolveUsername(String(formData.get("username") ?? ""), id);
    if ("code" in u) {
      return {
        error: t(u.code === "invalid" ? "usernameInvalid" : "usernameTaken"),
      };
    }
    setValues.username = u.value;
  }
  // username UNIQUE: bọc write, map lỗi UNIQUE (race) về message localized.
  try {
    await db.update(members).set(setValues).where(eq(members.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/username/i.test(msg)) return { error: t("usernameTaken") };
    throw e;
  }
  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Admin đặt lại mật khẩu cho member: sinh mật khẩu tạm ngẫu nhiên, hash lưu,
 * đặt hạn 24h + cờ bắt-đổi. Trả PLAINTEXT 1 LẦN để admin copy gửi member
 * (app không gửi mail). KHÔNG lưu/không log plaintext.
 *
 * Member login bằng mật khẩu tạm (còn hạn) sẽ bị gate bắt đặt mật khẩu mới
 * (must_change_password) trước khi dùng site; quá 24h thì login bị từ chối.
 */
export async function resetMemberPassword(memberId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return { error: t("invalidId") };
  }
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: { id: true },
  });
  if (!member) return { error: t("memberNotFound") };

  // Mật khẩu tạm: 10 ký tự từ bộ không dễ nhầm (bỏ 0/O/1/l/I). crypto ngẫu nhiên.
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let tempPassword = "";
  for (const b of bytes) tempPassword += ALPHABET[b % ALPHABET.length];

  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db
    .update(members)
    .set({
      passwordHash,
      passwordResetExpiresAt: expiresAt,
      mustChangePassword: true,
    })
    .where(eq(members.id, memberId));

  revalidatePath("/admin/members");
  // tempPassword chỉ trả về UI 1 lần — không lưu, không log.
  return { success: true as const, tempPassword, expiresAt };
}

/**
 * Trả về memberId được liên kết với admin hiện tại (cookie). Null nếu chưa link.
 * Dùng cho UI hiển thị 👑 trên member-list.
 */
export async function getCurrentAdminMemberId(): Promise<number | null> {
  const auth = await requireAdmin();
  if ("error" in auth) return null;
  const adminId = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminId)) return null;
  const row = await db.query.admins.findFirst({
    where: eq(admins.id, adminId),
    columns: { memberId: true },
  });
  return row?.memberId ?? null;
}

/**
 * Liên kết tài khoản admin hiện tại với 1 member. Cần thiết để `finalizeSession`
 * /  `closeSession` chạy được — admin phải biết "tôi là member nào" để loại
 * mình khỏi divisor + tránh tự tạo nợ cho chính mình.
 *
 * Pass `null` để hủy liên kết.
 */
export async function linkAdminToMember(memberId: number | null) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");
  const adminId = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminId)) {
    return { error: t("invalidAdminToken") };
  }

  if (memberId !== null) {
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return { error: t("invalidMemberId") };
    }
    const m = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true },
    });
    if (!m) return { error: t("memberNotFoundShort") };
  }

  await db.update(admins).set({ memberId }).where(eq(admins.id, adminId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: t("memberNotFound") };
  await db
    .update(members)
    .set({ isActive: !member.isActive })
    .where(eq(members.id, id));
  // Khóa/mở member = rời/vào quỹ (roster derive từ isActive). KHÔNG auto-hoàn —
  // balance đóng băng. Revalidate mọi surface phụ thuộc roster quỹ.
  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  revalidatePath("/admin/dashboard");
  revalidatePath("/my-fund");
  revalidatePath("/");
  return { success: true };
}

/**
 * Hard delete thành viên. Block khi còn dữ liệu tham chiếu (vote, attendance,
 * debt, fund, ledger, hoặc admin link). Member dính giao dịch tài chính phải
 * giữ — admin nên dùng `toggleMemberActive` để vô hiệu hóa thay vì xóa
 * (financial audit trail bị vỡ nếu hard-delete một member có ledger entry).
 */
export async function deleteMember(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: t("memberNotFound") };

  const [{ voteCount }] = await db
    .select({ voteCount: sql<number>`count(*)` })
    .from(votes)
    .where(eq(votes.memberId, id));
  const [{ attendCount }] = await db
    .select({ attendCount: sql<number>`count(*)` })
    .from(sessionAttendees)
    .where(
      or(
        eq(sessionAttendees.memberId, id),
        eq(sessionAttendees.invitedById, id),
      ),
    );
  const [{ debtCount }] = await db
    .select({ debtCount: sql<number>`count(*)` })
    .from(sessionDebts)
    .where(eq(sessionDebts.memberId, id));
  const [{ ledgerCount }] = await db
    .select({ ledgerCount: sql<number>`count(*)` })
    .from(financialTransactions)
    .where(eq(financialTransactions.memberId, id));
  const [{ adminCount }] = await db
    .select({ adminCount: sql<number>`count(*)` })
    .from(admins)
    .where(eq(admins.memberId, id));

  const refs: string[] = [];
  if (Number(voteCount) > 0)
    refs.push(t("refVote", { count: Number(voteCount) }));
  if (Number(attendCount) > 0)
    refs.push(t("refAttendance", { count: Number(attendCount) }));
  if (Number(debtCount) > 0)
    refs.push(t("refDebt", { count: Number(debtCount) }));
  if (Number(ledgerCount) > 0)
    refs.push(t("refLedger", { count: Number(ledgerCount) }));
  if (Number(adminCount) > 0) refs.push(t("refAdminLink"));

  if (refs.length > 0) {
    return {
      error: t("memberInUse", { refs: refs.join(", ") }),
    };
  }

  await db.delete(members).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Tìm các nhóm member trùng tên (case-insensitive, trim). Mỗi nhóm trả về
 * đầy đủ id + balance (sum financialTransactions in - out) + ledger count
 * + isActive để admin chọn ID giữ lại trước khi merge.
 */
export async function findDuplicateMembers() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      nickname: members.nickname,
      avatarKey: members.avatarKey,
      avatarUrl: members.avatarUrl,
      isActive: members.isActive,
      facebookId: members.facebookId,
      normalized: sql<string>`lower(trim(${members.name}))`,
    })
    .from(members);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.normalized) continue;
    const list = groups.get(r.normalized) ?? [];
    list.push(r);
    groups.set(r.normalized, list);
  }

  const rawGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  if (rawGroups.length === 0) return [];

  // Loại các cặp admin đã "Bỏ qua" (xác nhận KHÁC người dù trùng tên). Trong
  // mỗi nhóm, giữ member nếu còn ÍT NHẤT 1 partner CHƯA bị bỏ qua; nhóm còn < 2
  // member thì biến mất khỏi banner. Trường hợp phổ biến (nhóm 2 người): bỏ qua
  // cặp đó → cả 2 mất partner → nhóm ẩn hẳn.
  const ignoredRows = await db
    .select({
      low: dupIgnoredPairs.memberIdLow,
      high: dupIgnoredPairs.memberIdHigh,
    })
    .from(dupIgnoredPairs);
  const ignoredSet = new Set(ignoredRows.map((r) => `${r.low}-${r.high}`));
  const isIgnored = (a: number, b: number) =>
    ignoredSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

  const dupGroups = rawGroups
    .map((g) =>
      g.filter((m) => g.some((n) => n.id !== m.id && !isIgnored(m.id, n.id))),
    )
    .filter((g) => g.length > 1);
  if (dupGroups.length === 0) return [];

  // Pre-compute balance + ledger count cho từng member trong các nhóm dupe.
  // Dùng helper canonical `computeBalanceFromTransactions` thay vì sum
  // direction=in/out — trước đây sum này double-count `bank_payment_received`
  // (paired với fund_contribution) và cộng nhầm legacy `debt_*_confirmed`
  // direction=in → balance inflate, admin nhìn dupe report bị lệch. Giờ
  // chỉ tính từ fund_contribution / fund_deduction / fund_refund (reversal
  // pairs loại trừ tự động).
  const dupIds = dupGroups.flat().map((m) => m.id);
  const ledger = await db
    .select({
      id: financialTransactions.id,
      memberId: financialTransactions.memberId,
      type: financialTransactions.type,
      amount: financialTransactions.amount,
      reversalOfId: financialTransactions.reversalOfId,
    })
    .from(financialTransactions)
    .where(inArray(financialTransactions.memberId, dupIds));

  const txsByMember = new Map<number, typeof ledger>();
  const countByMember = new Map<number, number>();
  for (const id of dupIds) {
    txsByMember.set(id, []);
    countByMember.set(id, 0);
  }
  for (const t of ledger) {
    if (t.memberId == null) continue;
    txsByMember.get(t.memberId)?.push(t);
    countByMember.set(t.memberId, (countByMember.get(t.memberId) ?? 0) + 1);
  }
  const balanceById = new Map<number, { balance: number; count: number }>();
  for (const id of dupIds) {
    const txs = txsByMember.get(id) ?? [];
    const { balance } = computeBalanceFromTransactions(id, txs);
    balanceById.set(id, { balance, count: countByMember.get(id) ?? 0 });
  }

  return dupGroups.map((g) => ({
    name: g[0].name,
    members: g.map((m) => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      avatarKey: m.avatarKey,
      avatarUrl: m.avatarUrl,
      isActive: !!m.isActive,
      facebookId: m.facebookId,
      balance: balanceById.get(m.id)?.balance ?? 0,
      ledgerCount: balanceById.get(m.id)?.count ?? 0,
    })),
  }));
}

/**
 * Đánh dấu tất cả cặp trong 1 nhóm trùng tên là "KHÁC người" → ẩn nhóm khỏi
 * banner. Chèn mọi cặp (chuẩn hoá low < high) vào dup_ignored_pairs, bỏ qua cặp
 * đã có (unique index). Không đụng dữ liệu member, chỉ ghi bảng ignore. Idempotent.
 */
export async function ignoreDuplicateGroup(memberIds: number[]) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = z
    .array(z.number().int().positive())
    .min(2)
    .safeParse(memberIds);
  if (!parsed.success) return { error: "Danh sách member không hợp lệ" };

  // Dedupe + sort tăng dần: cặp (i<j) luôn có ids[i] < ids[j] = low < high.
  const ids = [...new Set(parsed.data)].sort((a, b) => a - b);
  if (ids.length < 2) return { error: "Cần ít nhất 2 member" };

  const pairs: { memberIdLow: number; memberIdHigh: number }[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ memberIdLow: ids[i], memberIdHigh: ids[j] });
    }
  }

  await db.insert(dupIgnoredPairs).values(pairs).onConflictDoNothing();

  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Gộp `sourceId` vào `targetId`: chuyển toàn bộ FK (votes, attendees, debts,
 * fund, ledger, admin link) từ source → target trong 1 transaction, rồi xóa
 * row source. Conflict resolution: nếu target đã có row cho cùng session
 * (votes / debts có UNIQUE constraint), giữ row của target, xóa của source.
 *
 * Ghi chú tài chính: balance được tính từ `financialTransactions`. Sau khi
 * `UPDATE memberId` từ source → target, balance của target = sum cả 2 cũ.
 * Đảm bảo `reconcile-fund` (I8) vẫn pass vì tổng in/out không đổi, chỉ đổi
 * chủ sở hữu.
 */
export async function mergeMember(sourceId: number, targetId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return { error: t("invalidId") };
  }
  if (sourceId === targetId) {
    return { error: t("cannotMergeSelf") };
  }

  const [source, target] = await Promise.all([
    db.query.members.findFirst({ where: eq(members.id, sourceId) }),
    db.query.members.findFirst({ where: eq(members.id, targetId) }),
  ]);
  if (!source) return { error: t("sourceMemberNotFound") };
  if (!target) return { error: t("targetMemberNotFound") };

  // B4 guard: khi source và target CÙNG có debt cho 1 buổi (conflict), nhánh
  // xử lý bên dưới LUÔN giữ debt của target và drop + reverse ledger của source.
  // Nếu chính SOURCE mới là bên đã nhận chuyển khoản thật cho buổi đó, merge sẽ
  // huỷ khoản tiền thật (tiền đã vào TK admin) trong khi debt target vẫn chưa
  // trả → thành viên bị đòi trả 2 lần. Tiền quỹ nội bộ thì re-point cân bằng an
  // toàn, nhưng tiền bank thật thì không thể tự hoà giải. Chặn lại, để admin xử
  // lý tay (xác nhận/huỷ khoản đó trước rồi merge).
  const targetDebtSessionSet = new Set(
    (
      await db
        .select({ sessionId: sessionDebts.sessionId })
        .from(sessionDebts)
        .where(eq(sessionDebts.memberId, targetId))
    ).map((r) => r.sessionId),
  );
  const sourceConflictDebtIds = (
    await db
      .select({ id: sessionDebts.id, sessionId: sessionDebts.sessionId })
      .from(sessionDebts)
      .where(eq(sessionDebts.memberId, sourceId))
  )
    .filter((d) => targetDebtSessionSet.has(d.sessionId))
    .map((d) => d.id);
  if (sourceConflictDebtIds.length > 0) {
    const bankMatch = await db.query.paymentNotifications.findFirst({
      where: and(
        inArray(paymentNotifications.matchedDebtId, sourceConflictDebtIds),
        eq(paymentNotifications.status, "matched"),
      ),
      columns: { id: true },
    });
    if (bankMatch) {
      return {
        error:
          "Không gộp được: bản ghi nguồn đã có chuyển khoản ngân hàng khớp cho một buổi mà bản ghi đích cũng có nợ. Hãy xử lý khoản thanh toán đó trước (xác nhận hoặc hoàn) rồi mới gộp, để không mất khoản tiền thật đã nhận.",
      };
    }
  }

  await db.transaction(async (tx) => {
    // 1. votes — UNIQUE (sessionId, memberId). Lấy danh sách session mà target
    //    đã có vote → xóa source ở các session đó (giữ target). Còn lại update.
    const targetVoteSessionIds = (
      await tx
        .select({ sessionId: votes.sessionId })
        .from(votes)
        .where(eq(votes.memberId, targetId))
    ).map((r) => r.sessionId);
    if (targetVoteSessionIds.length > 0) {
      await tx
        .delete(votes)
        .where(
          and(
            eq(votes.memberId, sourceId),
            inArray(votes.sessionId, targetVoteSessionIds),
          ),
        );
    }
    await tx
      .update(votes)
      .set({ memberId: targetId })
      .where(eq(votes.memberId, sourceId));

    // 2. sessionDebts — UNIQUE (sessionId, memberId). Cùng pattern. Không
    //    cộng dồn amount: source coi như duplicate, giữ row target.
    const targetDebtSessionIds = (
      await tx
        .select({ sessionId: sessionDebts.sessionId })
        .from(sessionDebts)
        .where(eq(sessionDebts.memberId, targetId))
    ).map((r) => r.sessionId);
    if (targetDebtSessionIds.length > 0) {
      // Trước khi xóa debt source bị conflict, NULL out FK từ ledger để
      // tránh dangling reference. Tương tự deleteSession pattern.
      const conflictDebtIds = (
        await tx
          .select({ id: sessionDebts.id })
          .from(sessionDebts)
          .where(
            and(
              eq(sessionDebts.memberId, sourceId),
              inArray(sessionDebts.sessionId, targetDebtSessionIds),
            ),
          )
      ).map((r) => r.id);
      if (conflictDebtIds.length > 0) {
        // F2 FIX: source và target đều đã finalize cùng session → mỗi bên
        // có 1 `fund_deduction` riêng cho cùng amount. Nếu chỉ NULL debtId
        // rồi step 4 bulk-update memberId source→target, target sẽ có 2
        // `fund_deduction` LIVE cho cùng session → bị trừ tiền 2 lần.
        //
        // Fix: trước khi xóa source debt, reverse các source fund_deduction
        // gắn với chúng (insert paired fund_contribution với reversalOfId).
        // Reversal row giữ memberId=sourceId để step 4 re-point cả cặp →
        // sau merge target có 1 deduction live + 1 voided pair, balance đúng.
        //
        // Cũng reverse các fund_contribution penalty/balance-fix nằm trên
        // các debt source bị drop (admin min-deduction surplus có
        // memberId=admin ≠ sourceId, nên KHÔNG được step 4 đụng đến →
        // phải reverse ở đây để admin không bị double-credit penalty).
        const sourceDeductions = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.type, "fund_deduction"),
            inArray(financialTransactions.debtId, conflictDebtIds),
            isNull(financialTransactions.reversalOfId),
          ),
        });
        for (const d of sourceDeductions) {
          // Idempotent: skip nếu đã có reversal pointing at this row.
          const existing = await tx.query.financialTransactions.findFirst({
            where: eq(financialTransactions.reversalOfId, d.id),
            columns: { id: true },
          });
          if (existing) continue;
          const r = await recordFinancialTransaction(
            {
              type: "fund_contribution",
              direction: "in",
              amount: d.amount,
              // Giữ memberId=source — step 4 re-point cả cặp → target
              // sở hữu cả deduction lẫn reversal → balance net = 0 cho
              // cặp đó, target chỉ còn deduction của riêng mình live.
              memberId: d.memberId,
              sessionId: d.sessionId,
              // debtId sắp được NULL out ngay sau loop này; giữ null từ đầu
              // cho khớp với state cuối cùng (debt sẽ bị xóa).
              debtId: null,
              reversalOfId: d.id,
              description: `Hoàn lại trừ quỹ khi merge member ${sourceId} → ${targetId} (debt #${d.debtId} bị drop)`,
              metadata: {
                source: "merge_member_conflict_reversal",
                fromMember: sourceId,
                toMember: targetId,
              },
              idempotencyKey: `merge-reverse-deduction-${d.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }

        // Admin penalty / bank balance-fix contributions tied to source's
        // dropped debts. memberId of these rows can be ≠ source (admin
        // penalty has memberId=adminMemberId). Reverse all of them so
        // admin isn't double-credited and bank balance-fix isn't orphaned.
        const sourceContribs = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.type, "fund_contribution"),
            inArray(financialTransactions.debtId, conflictDebtIds),
            isNull(financialTransactions.reversalOfId),
          ),
        });
        for (const c of sourceContribs) {
          if (c.memberId === null) continue;
          const existing = await tx.query.financialTransactions.findFirst({
            where: eq(financialTransactions.reversalOfId, c.id),
            columns: { id: true },
          });
          if (existing) continue;
          const r = await recordFinancialTransaction(
            {
              type: "fund_refund",
              direction: "out",
              amount: c.amount,
              memberId: c.memberId,
              sessionId: c.sessionId,
              debtId: null,
              reversalOfId: c.id,
              description: `Hoàn lại phụ phí khi merge member ${sourceId} → ${targetId} (debt #${c.debtId} bị drop)`,
              metadata: {
                source: "merge_member_conflict_contrib_reversal",
                fromMember: sourceId,
                toMember: targetId,
              },
              idempotencyKey: `merge-reverse-contrib-${c.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }

        await tx
          .update(financialTransactions)
          .set({ debtId: null })
          .where(inArray(financialTransactions.debtId, conflictDebtIds));
        await tx
          .delete(sessionDebts)
          .where(inArray(sessionDebts.id, conflictDebtIds));
      }
    }
    await tx
      .update(sessionDebts)
      .set({ memberId: targetId })
      .where(eq(sessionDebts.memberId, sourceId));

    // 3. sessionAttendees — không UNIQUE, chỉ cần update.
    await tx
      .update(sessionAttendees)
      .set({ memberId: targetId })
      .where(eq(sessionAttendees.memberId, sourceId));
    await tx
      .update(sessionAttendees)
      .set({ invitedById: targetId })
      .where(eq(sessionAttendees.invitedById, sourceId));

    // 3b. sessionMinDeductionExemptions — composite PK (sessionId, memberId).
    //     Bảng này có FK memberId ON DELETE CASCADE → nếu KHÔNG re-point trước
    //     khi xóa source, mọi exemption của source biến mất. Buổi đó re-finalize
    //     sẽ áp lại sàn 60K cho target (tưởng target không được miễn) → thu oan.
    //     Cùng pattern conflict như votes/debts: bỏ row source ở session mà
    //     target đã có exemption (PK trùng), còn lại re-point.
    const targetExemptSessionIds = (
      await tx
        .select({ sessionId: sessionMinDeductionExemptions.sessionId })
        .from(sessionMinDeductionExemptions)
        .where(eq(sessionMinDeductionExemptions.memberId, targetId))
    ).map((r) => r.sessionId);
    if (targetExemptSessionIds.length > 0) {
      await tx
        .delete(sessionMinDeductionExemptions)
        .where(
          and(
            eq(sessionMinDeductionExemptions.memberId, sourceId),
            inArray(
              sessionMinDeductionExemptions.sessionId,
              targetExemptSessionIds,
            ),
          ),
        );
    }
    await tx
      .update(sessionMinDeductionExemptions)
      .set({ memberId: targetId })
      .where(eq(sessionMinDeductionExemptions.memberId, sourceId));

    // 4. financialTransactions — bulk update. Balance của target sẽ tự sum.
    await tx
      .update(financialTransactions)
      .set({ memberId: targetId })
      .where(eq(financialTransactions.memberId, sourceId));

    // 5. (removed fundMembers re-point — roster derive từ members.isActive,
    //     không còn bảng fund_members. Ledger đã re-point ở bước 4.)

    // 6. admins.memberId — chuyển link nếu source được link.
    await tx
      .update(admins)
      .set({ memberId: targetId })
      .where(eq(admins.memberId, sourceId));

    // 6b. OAuth identities — gộp mọi tài khoản đăng nhập của source vào target
    //     TRƯỚC khi xóa source (FK cascade sẽ xóa identity còn trỏ về source).
    //     Sau merge, target đăng nhập được bằng cả tài khoản OAuth của source.
    await foldOAuthIntoTarget(tx, sourceId, targetId, {
      googleId: source.googleId,
      facebookId: source.facebookId,
      email: source.email,
    });

    // 7. Xóa member nguồn.
    await tx.delete(members).where(eq(members.id, sourceId));
  });

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Self-service (multi-SSO): member gỡ 1 tài khoản đăng nhập OAuth khỏi hồ sơ
 * của mình. Chặn gỡ PHƯƠNG THỨC ĐĂNG NHẬP CUỐI CÙNG khi chưa có mật khẩu (nếu
 * không member sẽ mất hẳn đường vào). Xoá cả cột legacy googleId/facebookId nếu
 * trùng uid — nếu không `findMemberByOAuth` fallback legacy vẫn cho login lại.
 */
export async function unlinkOAuthIdentity(identityId: number) {
  const t = await getTranslations("serverErrors");
  const user = await getUserFromCookie();
  if (!user) return { error: t("notSignedIn") };
  if (!Number.isInteger(identityId)) return { error: t("invalidId") };

  const rl = await checkRateLimit(
    `oauth-unlink:${user.memberId}`,
    10,
    5 * 60_000,
  );
  if (!rl.ok) {
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const identity = await db.query.memberOauthIdentities.findFirst({
    where: eq(memberOauthIdentities.id, identityId),
  });
  // Chỉ chủ hồ sơ mới gỡ được identity của chính mình.
  if (!identity || identity.memberId !== user.memberId) {
    return { error: t("oauthIdentityNotFound") };
  }

  // Mật khẩu dùng được (loại temp hết hạn) — ổn định trong thao tác này nên đọc
  // ngoài tx được. Số lượng identity thì phải đếm TRONG tx (chống race 2 lần gỡ).
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
    columns: { passwordHash: true, passwordResetExpiresAt: true },
  });
  const pwUsable = isUsablePassword(
    member?.passwordHash ?? null,
    member?.passwordResetExpiresAt ?? null,
  );

  // Pre-check nhanh (báo lỗi thân thiện, khỏi mở tx khi rõ là phương thức cuối).
  const pre = await countLoginMethods(user.memberId);
  if (pre.identities <= 1 && !pwUsable) {
    return { error: t("oauthLastMethod") };
  }

  const ROLLBACK = "__ROLLBACK_LAST_METHOD__";
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(memberOauthIdentities)
        .where(eq(memberOauthIdentities.id, identityId));
      // Re-check TRONG tx: đếm lại identity còn lại SAU khi xóa. Turso serialize
      // các write-tx → 2 lần gỡ đồng thời: cái sau thấy state của cái trước, nếu
      // còn 0 + không có mật khẩu dùng được thì rollback (chống tự khóa).
      const remaining = await tx
        .select({ id: memberOauthIdentities.id })
        .from(memberOauthIdentities)
        .where(eq(memberOauthIdentities.memberId, user.memberId));
      if (remaining.length === 0 && !pwUsable) {
        throw new Error(ROLLBACK);
      }
      // Dọn cột legacy nếu đang trỏ đúng uid vừa gỡ (fallback trong
      // findMemberByOAuth đọc cột này → phải clear để login qua uid đó tắt hẳn).
      if (identity.provider === "google") {
        await tx
          .update(members)
          .set({ googleId: null })
          .where(
            and(
              eq(members.id, user.memberId),
              eq(members.googleId, identity.providerUid),
            ),
          );
      } else {
        await tx
          .update(members)
          .set({ facebookId: null })
          .where(
            and(
              eq(members.id, user.memberId),
              eq(members.facebookId, identity.providerUid),
            ),
          );
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === ROLLBACK) {
      return { error: t("oauthLastMethod") };
    }
    throw e;
  }

  revalidatePath("/me");
  return { success: true };
}
