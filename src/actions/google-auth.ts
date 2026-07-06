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

/**
 * Verify Google ID token bằng tokeninfo endpoint (Google sẽ check signature,
 * exp, aud, iss giùm). Trả về claims đã verify hoặc null.
 *
 * Tradeoff: 1 network round trip thay vì local JWT verify với jwks. Tradeoff
 * chấp nhận được — login flow rare, latency không phải concern, và Google's
 * tokeninfo endpoint là canonical source.
 */
async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email?: string;
  /** Google đã xác minh email này thuộc user chưa. Chỉ tin `email` khi true. */
  emailVerified: boolean;
  name?: string;
  picture?: string;
} | null> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      aud?: string;
      iss?: string;
      sub?: string;
      email?: string;
      // tokeninfo trả string "true"/"false" (đôi khi boolean) → normalize.
      email_verified?: string | boolean;
      name?: string;
      picture?: string;
      exp?: string;
    };

    // Verify audience matches our client id
    if (data.aud !== clientId) return null;
    // Verify issuer is Google
    if (
      data.iss !== "https://accounts.google.com" &&
      data.iss !== "accounts.google.com"
    ) {
      return null;
    }
    // Verify not expired (tokeninfo also checks this, defense-in-depth)
    if (data.exp) {
      const expSec = parseInt(data.exp, 10);
      if (Number.isFinite(expSec) && expSec * 1000 < Date.now()) return null;
    }
    if (!data.sub) return null;

    return {
      sub: data.sub,
      email: data.email,
      emailVerified:
        data.email_verified === true || data.email_verified === "true",
      name: data.name,
      picture: data.picture,
    };
  } catch {
    return null;
  }
}

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
    if (
      claims.emailVerified &&
      claims.email &&
      existing.email !== claims.email
    ) {
      const emailTaken = await db.query.members.findFirst({
        where: eq(members.email, claims.email),
        columns: { id: true },
      });
      if (!emailTaken) updates.email = claims.email;
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
  let emailToWrite: string | null = claims.emailVerified
    ? (claims.email ?? null)
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
