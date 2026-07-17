"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, getUserFromCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { getTranslations } from "next-intl/server";
import {
  findMemberByOAuth,
  ensureOAuthIdentity,
  oauthLinkState,
} from "@/lib/oauth-identity";
import { verifyGoogleIdToken } from "@/lib/google-verify";

export async function googleLogin(idToken: string) {
  if (
    typeof idToken !== "string" ||
    idToken.length < 16 ||
    idToken.length > 4096
  ) {
    return { error: "Invalid Google ID token" };
  }

  // 10 Google login attempts per IP per 5 minutes
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`google-login:${ip}`, 10, 5 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const claims = await verifyGoogleIdToken(idToken);
  if (!claims) return { error: "Google verification failed" };

  // Find existing member qua bảng identity (multi-SSO), fallback cột legacy.
  const existing = await findMemberByOAuth("google", claims.sub);

  if (existing) {
    // Block deactivated OR rejected — parity with the password path.
    if (!existing.isActive || existing.approvalStatus === "rejected") {
      return { error: "Account deactivated. Contact admin." };
    }

    // Refresh name/avatar/email from Google if changed. Guard the email update
    // with a uniqueness check so a colliding email doesn't throw an unhandled
    // 500 (UNIQUE violation); skip the email field on collision.
    const updates: Partial<typeof members.$inferInsert> = {};
    if (claims.name && existing.name !== claims.name)
      updates.name = claims.name;
    if (claims.picture && existing.avatarUrl !== claims.picture)
      updates.avatarUrl = claims.picture;
    if (claims.emailVerified && claims.email) {
      // Lowercase để khớp normalizeEmail dùng ở password-auth / login-lookup —
      // email UNIQUE của SQLite phân biệt hoa-thường, nếu ghi thô case của
      // Workspace sẽ tạo bản trùng + login-by-email fail.
      const emailNorm = claims.email.trim().toLowerCase();
      if (existing.email !== emailNorm) {
        const emailTaken = await db.query.members.findFirst({
          where: eq(members.email, emailNorm),
          columns: { id: true },
        });
        if (!emailTaken) updates.email = emailNorm;
      }
    }
    if (Object.keys(updates).length > 0) {
      await db.update(members).set(updates).where(eq(members.id, existing.id));
    }

    // Lazy-link: row cũ (chỉ có cột legacy) được tạo identity row lần đầu login.
    await ensureOAuthIdentity({
      memberId: existing.id,
      provider: "google",
      uid: claims.sub,
      email: claims.email ?? null,
    });

    await setUserCookie(existing.id, `g:${claims.sub}`);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // KHÔNG auto-link theo email nữa (đã gỡ 2026-07-07). Trước đây: Google login
  // trùng email với 1 account FB-only sẽ tự gán Google vào account đó. Nhưng
  // email của account có thể do user tự nhập (updateMyProfile), nên kẻ xấu đặt
  // email = victim@gmail rồi chờ victim login Google lần đầu → chiếm tài khoản.
  // Giờ muốn thêm Google vào hồ sơ phải qua luồng liên kết tự phục vụ ở /me
  // (linkGoogleIdentity) — có verify quyền sở hữu token. Google trùng email
  // nhưng chưa có identity → tạo member pending mới (admin gộp nếu cần).

  // Email collision check cho nhánh tạo mới: chỉ ghi email khi Google ĐÃ XÁC
  // MINH (emailVerified) VÀ chưa bị account khác chiếm.
  let emailToWrite: string | null =
    claims.emailVerified && claims.email
      ? claims.email.trim().toLowerCase()
      : null;
  if (emailToWrite) {
    const collision = await db.query.members.findFirst({
      where: eq(members.email, emailToWrite),
      columns: { id: true },
    });
    if (collision) emailToWrite = null;
  }

  // Create new member — pending admin approval. Khác với member admin tạo
  // trực tiếp (mặc định approved): OAuth signup phải qua approval flow.
  const [newMember] = await db
    .insert(members)
    .values({
      name: claims.name ?? "Google user",
      googleId: claims.sub,
      email: emailToWrite,
      avatarUrl: claims.picture ?? null,
      approvalStatus: "pending",
    })
    .returning();

  await ensureOAuthIdentity({
    memberId: newMember.id,
    provider: "google",
    uid: claims.sub,
    email: claims.email ?? null,
  });
  await setUserCookie(newMember.id, `g:${claims.sub}`);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

/**
 * Self-service (multi-SSO): member ĐANG đăng nhập liên kết THÊM 1 tài khoản
 * Google vào hồ sơ của mình (ví dụ Google thứ 2). Khác `googleLogin`: KHÔNG
 * đổi cookie/không tạo member — chỉ thêm identity row cho member hiện tại.
 *
 * Chống chiếm tài khoản: tài khoản Google phải được XÁC THỰC (idToken verify)
 * và KHÔNG được đang thuộc member khác (oauthLinkState = "other" → chặn).
 */
export async function linkGoogleIdentity(idToken: string) {
  const t = await getTranslations("serverErrors");
  const user = await getUserFromCookie();
  if (!user) return { error: t("notSignedIn") };

  if (
    typeof idToken !== "string" ||
    idToken.length < 16 ||
    idToken.length > 4096
  ) {
    return { error: "Invalid Google ID token" };
  }

  // Rate-limit theo member để tránh spam link.
  const rl = await checkRateLimit(
    `oauth-link:${user.memberId}`,
    10,
    5 * 60_000,
  );
  if (!rl.ok) {
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member || !member.isActive) return { error: t("memberNotFound") };

  const claims = await verifyGoogleIdToken(idToken);
  if (!claims) return { error: "Google verification failed" };

  const state = await oauthLinkState("google", claims.sub, user.memberId);
  if (state.state === "other") {
    return { error: t("oauthLinkedToOther") };
  }

  // state "self" có thể đến từ cột legacy (member cũ, chưa có identity row) →
  // vẫn gọi ensureOAuthIdentity (idempotent) để backfill vào bảng identity, nếu
  // không /me sẽ không hiện/gỡ được tài khoản đó. Race UNIQUE (2 tab cùng link)
  // → ensureOAuthIdentity trả false hoặc ném lỗi unique → coi như đã thuộc nơi
  // khác/không link được.
  try {
    const ok = await ensureOAuthIdentity({
      memberId: user.memberId,
      provider: "google",
      uid: claims.sub,
      email: claims.emailVerified ? (claims.email ?? null) : null,
    });
    if (!ok) return { error: t("oauthLinkedToOther") };
  } catch {
    return { error: t("oauthLinkedToOther") };
  }
  revalidatePath("/me");
  return state.state === "self"
    ? { success: true, already: true as const }
    : { success: true };
}
