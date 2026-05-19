"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setUserCookie, getUserFromCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

const BCRYPT_ROUNDS = 10;

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidPassword(s: string): boolean {
  return typeof s === "string" && s.length >= 8 && s.length <= 128;
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
}) {
  // Rate limit: 5 signup attempts per IP per 10 minutes
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
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
  email: string;
  password: string;
}) {
  // Rate limit: 10 login attempts per IP per 5 minutes
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const rl = await checkRateLimit(`pw-login:${ip}`, 10, 5 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const email =
    typeof input.email === "string"
      ? normalizeEmail(input.email).slice(0, 200)
      : "";
  if (!isEmail(email)) {
    return { error: "Email hoặc mật khẩu không đúng" };
  }
  if (typeof input.password !== "string" || input.password.length < 1) {
    return { error: "Email hoặc mật khẩu không đúng" };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.email, email),
  });
  // Generic error message để không leak thông tin email có tồn tại không.
  if (!member || !member.passwordHash) {
    return { error: "Email hoặc mật khẩu không đúng" };
  }
  if (member.approvalStatus === "rejected" || !member.isActive) {
    return { error: "Tài khoản đã bị khóa. Liên hệ admin." };
  }

  const ok = await bcrypt.compare(input.password, member.passwordHash);
  if (!ok) {
    return { error: "Email hoặc mật khẩu không đúng" };
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
}) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Chưa đăng nhập" };

  if (!isValidPassword(input.newPassword)) {
    return { error: "Mật khẩu mới phải từ 8 đến 128 ký tự" };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member) return { error: "Không tìm thấy tài khoản" };

  // Nếu đã có password — yêu cầu current để bảo vệ chống hijack cookie.
  if (member.passwordHash) {
    if (
      typeof input.currentPassword !== "string" ||
      input.currentPassword.length < 1
    ) {
      return { error: "Cần nhập mật khẩu hiện tại" };
    }
    const ok = await bcrypt.compare(input.currentPassword, member.passwordHash);
    if (!ok) return { error: "Mật khẩu hiện tại không đúng" };
  }

  // Nếu chưa có email (user OAuth chỉ qua FB không cho email), bắt buộc add
  // email trước khi set password. Nhưng FB scope public_profile mặc định
  // không cho email → user phải nhập manually. Trường hợp này ít gặp.
  if (!member.email) {
    return {
      error:
        "Cần email để dùng password login. Vui lòng cập nhật email trong hồ sơ trước.",
    };
  }

  const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await db
    .update(members)
    .set({ passwordHash: hash })
    .where(eq(members.id, member.id));

  revalidatePath("/me");
  return { success: true };
}
