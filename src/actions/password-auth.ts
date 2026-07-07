"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setUserCookie, getUserFromCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { getTranslations } from "next-intl/server";
import {
  findMemberByIdentifier,
  normalizeIdentifier,
} from "@/lib/member-lookup";

// Parity with the admin path (auth.ts): cost 12 + reject >72 UTF-8 bytes.
const BCRYPT_ROUNDS = 12;

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidPassword(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length >= 8 &&
    s.length <= 128 &&
    // bcrypt silently TRUNCATES at 72 bytes — reject (don't truncate) so a
    // member's diacritic-heavy password (vd 25 ký tự 'ố' = 75 bytes) isn't
    // weakened to its first ~24 chars. Matches admin path (auth.ts).
    Buffer.byteLength(s, "utf8") <= 72
  );
}

/**
 * Signup with email + password. Tạo member mới ở trạng thái 'pending' —
 * giống OAuth flow, phải qua admin approval mới vào nhóm.
 */
export async function signupWithPassword(input: {
  name: string;
  email: string;
  password: string;
  nickname?: string;
  phoneNumber?: string;
  bankAccountNo?: string;
  defaultWithPartner?: boolean;
}) {
  // Rate limit: 5 signup attempts per IP per 10 minutes
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-signup:${ip}`, 5, 10 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const name =
    typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const email =
    typeof input.email === "string"
      ? normalizeEmail(input.email).slice(0, 200)
      : "";

  if (!name) return { error: "Tên không hợp lệ" };
  if (!isEmail(email)) return { error: "Email không hợp lệ" };
  if (!isValidPassword(input.password)) {
    return { error: "Mật khẩu phải từ 8 đến 128 ký tự" };
  }

  const existing = await db.query.members.findFirst({
    where: eq(members.email, email),
  });
  if (existing) {
    return { error: "Email này đã được dùng. Đăng nhập thay vì đăng ký?" };
  }

  const nickname =
    typeof input.nickname === "string"
      ? input.nickname.trim().slice(0, 64) || null
      : null;
  const phoneNumber =
    typeof input.phoneNumber === "string"
      ? input.phoneNumber.replace(/[^\d+]/g, "").slice(0, 20) || null
      : null;
  const bankAccountNo =
    typeof input.bankAccountNo === "string"
      ? input.bankAccountNo.replace(/[^\d]/g, "").slice(0, 32) || null
      : null;

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const [newMember] = await db
    .insert(members)
    .values({
      name,
      email,
      passwordHash,
      nickname,
      phoneNumber,
      bankAccountNo,
      defaultWithPartner: input.defaultWithPartner === true,
      approvalStatus: "pending",
    })
    .returning();

  await setUserCookie(newMember.id, `pw:${newMember.id}`);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

/**
 * Login with email + password. Trả về cookie hợp lệ; layout sẽ route theo
 * approvalStatus.
 */
export async function loginWithPassword(input: {
  /** Username / số điện thoại / email — login đa kênh. */
  identifier: string;
  password: string;
}) {
  const identifierRaw =
    typeof input.identifier === "string" ? input.identifier.slice(0, 200) : "";
  const identifierNorm = normalizeIdentifier(identifierRaw);

  // Rate limit: theo IP (chống enum) + theo identifier (chống guess 1 acc).
  const ip = await getTrustedClientIp();
  const t = await getTranslations("serverErrors");
  for (const key of [
    `pw-login:${ip}`,
    identifierNorm ? `pw-login-user:${identifierNorm}` : null,
  ]) {
    if (!key) continue;
    const rl = await checkRateLimit(key, 10, 5 * 60_000);
    if (!rl.ok) {
      return {
        error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
      };
    }
  }

  // Lỗi CHUNG cho mọi nhánh sai — không lộ định danh nào tồn tại.
  const GENERIC = "Định danh hoặc mật khẩu không đúng";
  if (!identifierNorm) return { error: GENERIC };
  if (typeof input.password !== "string" || input.password.length < 1) {
    return { error: GENERIC };
  }

  const member = await findMemberByIdentifier(identifierRaw);
  if (!member || !member.passwordHash) {
    return { error: GENERIC };
  }

  const ok = await bcrypt.compare(input.password, member.passwordHash);
  if (!ok) {
    return { error: GENERIC };
  }

  // Chỉ lộ trạng thái khóa SAU khi mật khẩu đã đúng. Nếu check trước bcrypt,
  // kẻ tấn công vô danh phân biệt được tài khoản khóa/rejected (thông báo khác)
  // với định danh không tồn tại → enumerate được thành viên. Người nhập đúng
  // mật khẩu là chủ tài khoản nên báo "đã khóa" cho họ là hợp lý.
  if (member.approvalStatus === "rejected" || !member.isActive) {
    return { error: "Tài khoản đã bị khóa. Liên hệ admin." };
  }

  // Mật khẩu tạm (admin reset) đã hết hạn → từ chối, bắt xin admin cấp lại.
  // Còn hạn → cho vào, gate `must_change_password` sẽ bắt đổi trước khi dùng.
  if (
    member.passwordResetExpiresAt &&
    new Date(member.passwordResetExpiresAt).getTime() < Date.now()
  ) {
    return {
      error: "Mật khẩu tạm đã hết hạn. Liên hệ admin để cấp lại.",
    };
  }

  await setUserCookie(member.id, `pw:${member.id}`);
  revalidatePath("/");
  return { success: true, memberName: member.name };
}

/**
 * Set/change password. User đã login (qua bất kỳ provider nào) đều có thể
 * set hoặc đổi password.
 *
 * - Lần đầu set: chỉ cần newPassword.
 * - Đổi (đã có hash): yêu cầu currentPassword.
 */
export async function setPassword(input: {
  currentPassword?: string;
  newPassword: string;
  email?: string;
}) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Chưa đăng nhập" };

  // Rate limit: 5 set-password attempts per member per 5 minutes. Caps
  // online bcrypt.compare guesses on currentPassword for cookie-fixated
  // attackers, and caps email-claim retries (relevant to anti-squat path).
  const rl = await checkRateLimit(
    `set-password:${user.memberId}`,
    5,
    5 * 60_000,
  );
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  if (!isValidPassword(input.newPassword)) {
    return { error: "Mật khẩu mới phải từ 8 đến 128 ký tự" };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member) return { error: "Không tìm thấy tài khoản" };

  // Nếu đã có password — yêu cầu current để bảo vệ chống hijack cookie.
  // NGOẠI LỆ: đang ở chế độ bắt-đổi (admin vừa reset, mustChangePassword=true)
  // → member login bằng mật khẩu tạm, không cần nhập lại "current" (họ chỉ có
  // mật khẩu tạm, mục đích là đặt cái mới ngay).
  if (member.passwordHash && !member.mustChangePassword) {
    if (
      typeof input.currentPassword !== "string" ||
      input.currentPassword.length < 1
    ) {
      return { error: "Cần nhập mật khẩu hiện tại" };
    }
    const ok = await bcrypt.compare(input.currentPassword, member.passwordHash);
    if (!ok) return { error: "Mật khẩu hiện tại không đúng" };
  }

  // Nếu chưa có email — cho user nhập kèm trong form. Validate + check unique
  // trước khi save. Email là UNIQUE column.
  let emailToSave: string | null = null;
  if (!member.email) {
    const raw =
      typeof input.email === "string"
        ? normalizeEmail(input.email).slice(0, 200)
        : "";
    if (!raw || !isEmail(raw)) {
      return { error: "Cần nhập email hợp lệ để đặt mật khẩu" };
    }
    const existing = await db.query.members.findFirst({
      where: eq(members.email, raw),
      columns: { id: true },
    });
    if (existing && existing.id !== member.id) {
      return { error: "Email này đã được dùng bởi tài khoản khác" };
    }
    emailToSave = raw;
  }

  const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await db
    .update(members)
    .set({
      passwordHash: hash,
      ...(emailToSave ? { email: emailToSave } : {}),
      // Đổi xong → gỡ chế độ bắt-đổi + xoá hạn mật khẩu tạm (nếu có).
      mustChangePassword: false,
      passwordResetExpiresAt: null,
    })
    .where(eq(members.id, member.id));

  revalidatePath("/me");
  revalidatePath("/");
  return { success: true };
}
