"use server";

/**
 * Password-reset actions dùng chung cho member VÀ admin. Xem thiết kế:
 * docs/superpowers/specs/2026-06-16-forgot-password-design.md §6 (member),
 * mở rộng thêm subject "admin" (cùng bảng password_reset_tokens, phân biệt
 * bằng member_id XOR admin_id).
 *
 * Bất biến bảo mật (KHÔNG được phá vỡ khi sửa file này):
 *  - requestPasswordReset LUÔN trả cùng 1 thông báo trung tính — email không
 *    tồn tại / rate-limit / lỗi DB đều KHÔNG được phân biệt được từ bên
 *    ngoài (chống email enumeration).
 *  - Token chỉ lưu sha256(token), KHÔNG BAO GIỜ log raw token.
 *  - Single-use bằng CAS (conditional UPDATE dựa vào WHERE, không
 *    read-rồi-write) — an toàn kể cả 2 submit đồng thời.
 */

import { db } from "@/db";
import { members, admins, passwordResetTokens } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { clearUserCookie } from "@/lib/user-identity";
import { sendPasswordResetEmail } from "@/lib/mailer";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiryIso,
  isResetTokenExpired,
} from "@/lib/password-reset-token";

// password-auth.ts có "use server" ở đầu file → chỉ được export async
// function, không thể export thẳng các helper thuần này. Giữ bản sao private
// tại đây (đã đồng bộ logic), giống cách google-auth.ts đang làm.
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
    // bcrypt silently TRUNCATES at 72 bytes — reject (parity với password-auth.ts).
    Buffer.byteLength(s, "utf8") <= 72
  );
}

/**
 * Retry a single DB write on SQLITE_BUSY. Production Turso auto-retries at
 * the client layer (per rate-limit.ts), but the file-based libsql driver
 * used in tests/self-host does not — two concurrent CAS updates on the same
 * connection can otherwise throw instead of the loser simply affecting 0
 * rows. Mirrors the backoff already used in rate-limit.ts's doCheck.
 */
async function withBusyRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
      const isBusy =
        msg.includes("SQLITE_BUSY") ||
        msg.includes("database is locked") ||
        msg.includes("BUSY");
      if (!isBusy || attempt >= 5) throw err;
      const backoffMs = Math.min(50, 5 * 2 ** attempt) + Math.random() * 5;
      await new Promise((r) => setTimeout(r, backoffMs));
      attempt += 1;
    }
  }
}

type Scope = "member" | "admin";

/** Invalidate the subject's old unused tokens + insert a new one, then send
 * the email via after() so the SMTP round-trip never blocks (or times) the
 * response — required for the anti-enumeration guarantee in §8. */
async function issueTokenAndSend(
  subject: { memberId: number } | { adminId: number },
  email: string,
) {
  const { rawToken, tokenHash } = generateResetToken();
  const expiresAt = resetTokenExpiryIso();

  await db.transaction(async (tx) => {
    if ("memberId" in subject) {
      await tx
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.memberId, subject.memberId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      await tx.insert(passwordResetTokens).values({
        memberId: subject.memberId,
        tokenHash,
        expiresAt,
      });
    } else {
      await tx
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.adminId, subject.adminId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      await tx.insert(passwordResetTokens).values({
        adminId: subject.adminId,
        tokenHash,
        expiresAt,
      });
    }
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const resetUrl = `${base}/reset-password/${rawToken}`;

  after(() => {
    sendPasswordResetEmail(email, resetUrl).catch((err) => {
      console.error("[PasswordReset] mail send failed:", err);
    });
  });
}

/**
 * Request a password-reset link for a member or admin account. ALWAYS
 * resolves to the same neutral response regardless of whether the email
 * exists, rate limits were hit, or a DB error occurred — none of that may be
 * observable from the outside.
 */
export async function requestPasswordReset(input: {
  email: string;
  scope: Scope;
}): Promise<{ ok: true; message: string }> {
  const tPasswordReset = await getTranslations("passwordReset");
  const NEUTRAL = {
    ok: true as const,
    message: tPasswordReset("neutralConfirm"),
  };
  try {
    const scope: Scope = input.scope === "admin" ? "admin" : "member";
    const emailNorm = normalizeEmail(
      typeof input.email === "string" ? input.email : "",
    );

    const ip = await getTrustedClientIp();
    const rlIp = await checkRateLimit(
      `pw-reset-req:${scope}:${ip}`,
      5,
      10 * 60_000,
    );
    const rlEmail = emailNorm
      ? await checkRateLimit(
          `pw-reset-req-email:${scope}:${emailNorm}`,
          3,
          15 * 60_000,
        )
      : { ok: true, remaining: 0 };
    if (!rlIp.ok || !rlEmail.ok) {
      return NEUTRAL;
    }

    if (!isEmail(emailNorm)) return NEUTRAL;

    if (scope === "admin") {
      const admin = await db.query.admins.findFirst({
        where: eq(admins.email, emailNorm),
      });
      if (!admin?.email) return NEUTRAL;
      await issueTokenAndSend({ adminId: admin.id }, admin.email);
      return NEUTRAL;
    }

    // Cho phép: isActive + KHÔNG rejected + có email. passwordHash null
    // (OAuth-only) vẫn hợp lệ — đây chính là luồng đặt mật khẩu lần đầu.
    const member = await db.query.members.findFirst({
      where: eq(members.email, emailNorm),
    });
    if (
      !member?.email ||
      !member.isActive ||
      member.approvalStatus === "rejected"
    ) {
      return NEUTRAL;
    }
    await issueTokenAndSend({ memberId: member.id }, member.email);
    return NEUTRAL;
  } catch (err) {
    console.error("[PasswordReset] requestPasswordReset error:", err);
    return NEUTRAL;
  }
}

/**
 * Complete a reset: single-use via CAS (conditional UPDATE keyed off the
 * WHERE clause, never a separate read-then-write), then hash + write the new
 * password to whichever table (members/admins) the token's FK points at.
 * Never issues a new session — member subject clears the current cookie so
 * the app actually routes back to the login gate afterwards.
 */
export async function resetPasswordWithToken(input: {
  token: string;
  newPassword: string;
}): Promise<
  | { success: true; subject: Scope }
  | { tokenError: string }
  | { passwordError: string }
> {
  const tPasswordReset = await getTranslations("passwordReset");

  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      tokenError: t("tooManyResetRequests", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  // Password validated BEFORE the token is consumed — a weak password must
  // leave the token untouched so the user can retry on the same link.
  if (!isValidPassword(input.newPassword)) {
    return { passwordError: tPasswordReset("passwordTooShort") };
  }

  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { tokenError: tPasswordReset("tokenError") };

  const tokenHash = hashResetToken(token);
  const nowIso = new Date().toISOString();

  const casResult = await withBusyRetry(() =>
    db
      .update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, nowIso),
        ),
      ),
  );

  if (casResult.rowsAffected !== 1) {
    return { tokenError: tPasswordReset("tokenError") };
  }

  // CAS đã thắng — an toàn đọc lại để biết token thuộc member hay admin
  // (không còn TOCTOU vì usedAt đã được ghi atomically ở bước trên).
  const tokenRow = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, tokenHash),
    columns: { memberId: true, adminId: true },
  });

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

  if (tokenRow?.memberId != null) {
    await db
      .update(members)
      .set({
        passwordHash,
        // Đổi mật khẩu thật (self-service) → gỡ luôn cờ bắt-đổi + hạn mật
        // khẩu tạm nếu có, tránh member bị loginWithPassword từ chối vì
        // "mật khẩu tạm hết hạn" dù họ vừa tự đặt mật khẩu MỚI.
        mustChangePassword: false,
        passwordResetExpiresAt: null,
      })
      .where(eq(members.id, tokenRow.memberId));

    // Vô hiệu các token còn lại của member (chống link song song).
    await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.memberId, tokenRow.memberId),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    await clearUserCookie();
    return { success: true, subject: "member" };
  }

  if (tokenRow?.adminId != null) {
    await db
      .update(admins)
      .set({ passwordHash })
      .where(eq(admins.id, tokenRow.adminId));

    await db
      .delete(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.adminId, tokenRow.adminId),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    return { success: true, subject: "admin" };
  }

  // Không nên xảy ra (CAS khớp 1 row nhưng cả 2 FK đều null) — fail closed.
  return { tokenError: tPasswordReset("tokenError") };
}

/**
 * Read-only check used to render the reset-password page (GET-time).
 * Collapses used/expired/malformed/rate-limited into a single "invalid" so a
 * token that once existed can't be distinguished from one that never did.
 */
export async function validateResetToken(input: {
  token: string;
}): Promise<{ status: "valid" | "invalid"; subject?: Scope }> {
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`pw-reset-validate:${ip}`, 20, 10 * 60_000);
  if (!rl.ok) return { status: "invalid" };

  const token = typeof input.token === "string" ? input.token : "";
  if (!token) return { status: "invalid" };

  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashResetToken(token)),
  });
  if (!row || row.usedAt || isResetTokenExpired(row.expiresAt)) {
    return { status: "invalid" };
  }

  if (row.memberId != null) return { status: "valid", subject: "member" };
  if (row.adminId != null) return { status: "valid", subject: "admin" };
  return { status: "invalid" };
}
