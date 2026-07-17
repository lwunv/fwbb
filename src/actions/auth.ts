"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setAdminCookie, clearAdminCookie, requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loginSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { getTranslations } from "next-intl/server";
import { normalizeUsername } from "@/lib/username";

export async function login(
  _prevState: { error: string } | null,
  formData: FormData,
) {
  const t = await getTranslations("serverErrors");
  const raw = {
    username: formData.get("username") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: t("missingFields") };
  }

  // Rate-limit 2-tầng:
  // 1. Per (IP+username): 5 lần / 5 phút — chống guess password 1 user
  // 2. Per IP: 20 lần / 5 phút — chống enum username (mỗi username mới
  //    không reset bucket #1 → unbounded brute-force giữa nhiều username)
  const ip = await getTrustedClientIp();
  const rlIp = await checkRateLimit(`login-ip:${ip}`, 20, 5 * 60_000);
  if (!rlIp.ok) {
    return {
      error: t("tooManyLoginAttempts", { seconds: rlIp.retryAfter ?? 60 }),
    };
  }
  const rl = await checkRateLimit(
    `login:${ip}:${parsed.data.username}`,
    5,
    5 * 60_000,
  );
  if (!rl.ok) {
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }
  const admin = await db.query.admins.findFirst({
    where: eq(admins.username, parsed.data.username),
  });

  const passwordOk =
    !!admin && (await bcrypt.compare(parsed.data.password, admin.passwordHash));

  if (!admin || !passwordOk) {
    // Per-USERNAME (IP-independent) throttle — but consumed ONLY on FAILED
    // attempts. A correct-password login skips this branch entirely, so an
    // attacker trickling wrong guesses can no longer lock the real admin out
    // (the previous version pre-checked this bucket BEFORE bcrypt → a hard
    // block on valid logins too = trivial account-lockout DoS). Distributed
    // guessing across rotating IPs is still throttled per account.
    const rlUser = await checkRateLimit(
      `login-user:${parsed.data.username}`,
      10,
      15 * 60_000,
    );
    if (!rlUser.ok) {
      return {
        error: t("tooManyLoginAttempts", { seconds: rlUser.retryAfter ?? 900 }),
      };
    }
    return { error: t("invalidCredentials") };
  }

  await setAdminCookie(admin.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}

export async function changePassword(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const t = await getTranslations("serverErrors");
  // Auth gate — Server Action có thể bị gọi qua RPC từ bất kỳ HTTP endpoint
  // nào, không chỉ từ admin form. Trước đây thiếu check này → ai cũng có
  // thể spam guess current password.
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  // Rate-limit per IP — bcrypt 12 round ~250ms/attempt, vẫn cần chặn online
  // brute-force ở quy mô lớn. Bucket 5 lần / 5 phút.
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`change-password:${ip}`, 5, 5 * 60_000);
  if (!rl.ok) {
    return {
      error: t("tooManyChangePassword", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: t("missingFields") };
  }

  // Unified password policy: min 8 chars (was 6 — too weak), max 72 bytes
  // (bcrypt silently truncates past byte 72 → user thinks they have a longer
  // password than what is actually hashed).
  if (newPassword.length < 8) {
    return { error: t("newPasswordTooShort") };
  }
  if (Buffer.byteLength(newPassword, "utf8") > 72) {
    return { error: t("newPasswordTooShort") };
  }

  if (newPassword !== confirmPassword) {
    return { error: t("newPasswordMismatch") };
  }

  // Resolve admin id from cookie (auth.admin.sub) thay vì findFirst() —
  // findFirst giả định 1 admin duy nhất, sai khi có >1 admin trong DB.
  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) {
    return { error: t("invalidAdminSession") };
  }
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
  });
  if (!admin) {
    return { error: t("adminAccountNotFound") };
  }

  const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!isValid) {
    return { error: t("wrongCurrentPassword") };
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(admins)
    .set({ passwordHash: newHash })
    .where(eq(admins.id, admin.id));

  return { success: true };
}

/** Hồ sơ admin hiện tại (theo cookie.sub). Không bao giờ trả passwordHash. */
export async function getCurrentAdmin() {
  const auth = await requireAdmin();
  if ("error" in auth) return null;
  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) return null;
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
    columns: { id: true, username: true, email: true, phoneNumber: true },
  });
  return admin ?? null;
}

/**
 * Admin tự sửa hồ sơ đăng nhập: username / email / phone. Chỉ đụng field khi
 * form CÓ gửi (formData.has). Unique tra trong phạm vi bảng admins (excludeId =
 * chính admin). Bọc write map lỗi UNIQUE (race) về message localized.
 */
export async function updateAdminProfile(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const t = await getTranslations("serverErrors");
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`admin-profile:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) return { error: t("invalidAdminSession") };
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
  });
  if (!admin) return { error: t("adminAccountNotFound") };

  const setValues: Partial<typeof admins.$inferInsert> = {};

  if (formData.has("username")) {
    const fmt = normalizeUsername(String(formData.get("username") ?? ""));
    // admins.username NOT NULL → rỗng hoặc sai format đều từ chối.
    if ("code" in fmt || fmt.value === null) {
      return { error: t("usernameInvalid") };
    }
    const dup = await db.query.admins.findFirst({
      where: and(eq(admins.username, fmt.value), ne(admins.id, admin.id)),
      columns: { id: true },
    });
    if (dup) return { error: t("usernameTaken") };
    setValues.username = fmt.value;
  }

  if (formData.has("email")) {
    const raw = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (raw) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return { error: t("emailInvalid") };
      }
      const dup = await db.query.admins.findFirst({
        where: and(eq(admins.email, raw), ne(admins.id, admin.id)),
        columns: { id: true },
      });
      if (dup) return { error: t("emailTaken") };
      setValues.email = raw;
    } else {
      setValues.email = null;
    }
  }

  if (formData.has("phoneNumber")) {
    const digits = String(formData.get("phoneNumber") ?? "").replace(
      /[^\d]/g,
      "",
    );
    setValues.phoneNumber = digits || null;
  }

  if (Object.keys(setValues).length === 0) return { success: true };

  try {
    await db.update(admins).set(setValues).where(eq(admins.id, admin.id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/username/i.test(msg)) return { error: t("usernameTaken") };
    if (/email/i.test(msg)) return { error: t("emailTaken") };
    throw e;
  }

  revalidatePath("/admin/account");
  return { success: true };
}
