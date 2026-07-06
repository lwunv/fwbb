"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp } from "@/lib/client-ip";
import { getTranslations } from "next-intl/server";
import { findMemberByOAuth, ensureOAuthIdentity } from "@/lib/oauth-identity";

interface FacebookUserInfo {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
}

export async function facebookLogin(accessToken: string) {
  if (
    typeof accessToken !== "string" ||
    accessToken.length < 16 ||
    accessToken.length > 1024
  ) {
    return { error: "Invalid access token" };
  }

  // 10 FB login attempts per IP per 5 minutes
  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(`fb-login:${ip}`, 10, 5 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    const t = await getTranslations("serverErrors");
    return { error: t("fbAppNotConfigured") };
  }

  // 1a. debug_token: verify the access token was issued for OUR app and is valid
  try {
    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    );
    if (!debugRes.ok) return { error: "Facebook verification failed" };
    const debugJson = (await debugRes.json()) as {
      data?: { app_id?: string; is_valid?: boolean; user_id?: string };
    };
    const data = debugJson.data;
    if (!data?.is_valid || data.app_id !== appId || !data.user_id) {
      return { error: "Facebook token rejected" };
    }
  } catch {
    return { error: "Failed to verify Facebook token" };
  }

  // 1b. Fetch user profile
  let fbUser: FacebookUserInfo;
  try {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      return { error: "Facebook verification failed" };
    }
    fbUser = await res.json();
  } catch {
    return { error: "Failed to connect to Facebook" };
  }

  if (!fbUser.id || !fbUser.name) {
    return { error: "Invalid Facebook response" };
  }

  // 2. Find existing member qua bảng identity (multi-SSO), fallback cột legacy.
  const existing = await findMemberByOAuth("facebook", fbUser.id);

  if (existing) {
    // Check if deactivated OR rejected — match the password path
    // (loginWithPassword blocks both). rejectMember sets approvalStatus
    // without clearing isActive, so OAuth must also block rejected.
    if (!existing.isActive || existing.approvalStatus === "rejected") {
      return { error: "Account deactivated. Contact admin." };
    }

    // Update name/avatar if changed
    const avatarUrl = fbUser.picture?.data?.url ?? null;
    if (existing.name !== fbUser.name || existing.avatarUrl !== avatarUrl) {
      await db
        .update(members)
        .set({
          name: fbUser.name,
          avatarUrl,
        })
        .where(eq(members.id, existing.id));
    }

    await ensureOAuthIdentity({
      memberId: existing.id,
      provider: "facebook",
      uid: fbUser.id,
      email: null,
    });
    await setUserCookie(existing.id, existing.facebookId ?? `fb:${fbUser.id}`);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // 3. Create new member — pending admin approval. Khác với member admin
  // tạo trực tiếp (mặc định approved): OAuth signup phải qua approval flow.
  const avatarUrl = fbUser.picture?.data?.url ?? null;
  const [newMember] = await db
    .insert(members)
    .values({
      name: fbUser.name,
      facebookId: fbUser.id,
      avatarUrl,
      approvalStatus: "pending",
    })
    .returning();

  await ensureOAuthIdentity({
    memberId: newMember.id,
    provider: "facebook",
    uid: fbUser.id,
    email: null,
  });
  await setUserCookie(newMember.id, newMember.facebookId ?? `fb:${fbUser.id}`);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
