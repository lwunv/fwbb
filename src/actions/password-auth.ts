"use server";

import { db } from "@/db";
import { members, passwordResetTokens } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  setUserCookie,
  getUserFromCookie,
  clearUserCookie,
} from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { getTranslations } from "next-intl/server";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiryIso,
  isResetTokenExpired,
} from "@/lib/password-reset-token";
import { sendPasswordResetEmail } from "@/lib/mailer";

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
  email: string;
  password: string;
}) {
  // Rate limit: 10 login attempts per IP per 5 minutes
  const ip = await getTrustedClientIp();
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
    })
    .where(eq(members.id, member.id));

  revalidatePath("/me");
  return { success: true };
}

// Canonical https origin used to build the reset link. NOT derived from the
// Host header (host-header injection would poison the link). Set APP_BASE_URL.
const RESET_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

/**
 * Step 1 of forgot-password. ALWAYS returns the same neutral success shape
 * (anti-enumeration). Sends the email off the request path via after() so the
 * branch that sends isn't measurably slower than the branch that doesn't.
 */
export async function requestPasswordReset(input: { email: string }) {
  const t = await getTranslations("serverErrors");
  // Normalize BEFORE building any rate-limit key so casing variants share a
  // bucket (Foo@x == foo@x), matching loginWithPassword's normalization.
  const email =
    typeof input.email === "string"
      ? normalizeEmail(input.email).slice(0, 200)
      : "";

  const ip = await getTrustedClientIp();
  const ipRl = await checkRateLimit(`pw-reset-req:${ip}`, 5, 10 * 60_000);
  if (!ipRl.ok) {
    return {
      error: t("tooManyResetRequests", { seconds: ipRl.retryAfter ?? 60 }),
    };
  }
  if (isEmail(email)) {
    const emailRl = await checkRateLimit(
      `pw-reset-req-email:${email}`,
      3,
      15 * 60_000,
    );
    if (!emailRl.ok) {
      return {
        error: t("tooManyResetRequests", { seconds: emailRl.retryAfter ?? 60 }),
      };
    }
  }

  // Neutral path: do the work only for a valid, contactable member; always
  // return the same success object regardless.
  if (isEmail(email)) {
    const member = await db.query.members.findFirst({
      where: eq(members.email, email),
    });
    if (
      member &&
      member.email &&
      member.isActive &&
      member.approvalStatus !== "rejected"
    ) {
      try {
        const { rawToken, tokenHash } = generateResetToken();
        const expiresAt = resetTokenExpiryIso();
        await db.transaction(async (tx) => {
          // Invalidate previous unused tokens for this member.
          await tx
            .update(passwordResetTokens)
            .set({ usedAt: new Date().toISOString() })
            .where(
              and(
                eq(passwordResetTokens.memberId, member.id),
                isNull(passwordResetTokens.usedAt),
              ),
            );
          await tx
            .insert(passwordResetTokens)
            .values({ memberId: member.id, tokenHash, expiresAt });
        });
        const resetUrl = `${RESET_BASE_URL}/reset-password/${rawToken}`;
        console.warn(
          `[PasswordReset] requested memberId=${member.id} ip=${ip}`,
        );
        // Send off the request path (kills timing oracle + serverless-safe).
        const memberEmail = member.email;
        const send = () => void sendPasswordResetEmail(memberEmail, resetUrl);
        try {
          after(send);
        } catch {
          // Outside a request scope (e.g. unit tests) — send directly.
          send();
        }
      } catch (err) {
        // DB error must NOT change the response shape (enumeration defense).
        console.error(
          "[PasswordReset] request failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return { success: true };
}

/**
 * GET-time check for the reset page. Binary status to the unauthenticated
 * caller (used/expired/malformed all collapse to "invalid" — don't leak that a
 * token once existed). Rate-limited per IP.
 */
export async function validateResetToken(input: {
  token: string;
}): Promise<{ status: "valid" | "invalid" }> {
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset-validate:${ip}`, 30, 10 * 60_000);
  if (!rl.ok) return { status: "invalid" };

  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { status: "invalid" };
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashResetToken(token)),
  });
  if (!row || row.usedAt || isResetTokenExpired(row.expiresAt)) {
    return { status: "invalid" };
  }
  return { status: "valid" };
}

/**
 * Step 2 of forgot-password. Atomic compare-and-swap on usedAt guarantees
 * single-use even under concurrent submits. Does NOT create a session — it
 * clears the existing cookie so the user re-logs in with the new password.
 */
export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
}): Promise<
  { success: true } | { tokenError: string } | { passwordError: string }
> {
  const t = await getTranslations("serverErrors");
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) {
    return {
      tokenError: t("tooManyResetRequests", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  if (!isValidPassword(input.newPassword)) {
    return { passwordError: "Mật khẩu mới phải từ 8 đến 128 ký tự" };
  }
  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { tokenError: "Liên kết không hợp lệ hoặc đã hết hạn" };

  const tokenHash = hashResetToken(token);
  const nowIso = new Date().toISOString();
  const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  let consumedMemberId: number | null = null;
  await db.transaction(async (tx) => {
    // Atomic CAS: only succeeds if the token is unused AND not expired.
    const res = await tx
      .update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, nowIso),
        ),
      );
    if (res.rowsAffected !== 1) return; // already used / expired / not found

    const row = await tx.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, tokenHash),
    });
    if (!row) return;
    await tx
      .update(members)
      .set({ passwordHash: hash })
      .where(eq(members.id, row.memberId));
    // Invalidate any other live tokens for this member.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(passwordResetTokens.memberId, row.memberId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    consumedMemberId = row.memberId;
  });

  if (consumedMemberId === null) {
    return { tokenError: "Liên kết không hợp lệ hoặc đã hết hạn" };
  }
  await clearUserCookie();
  console.warn(`[PasswordReset] completed memberId=${consumedMemberId}`);
  revalidatePath("/");
  return { success: true };
}
