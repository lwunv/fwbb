"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

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
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const rl = await checkRateLimit(`fb-login:${ip}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return {
      error: `Quá nhiều lần đăng nhập, thử lại sau ${rl.retryAfter ?? 60}s`,
    };
  }

  const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    return { error: "Facebook app not configured" };
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

  // 2. Find existing member by facebookId
  const existing = await db.query.members.findFirst({
    where: eq(members.facebookId, fbUser.id),
  });

  if (existing) {
    // Check if deactivated
    if (!existing.isActive) {
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

    await setUserCookie(existing.id, existing.facebookId);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // 3. Create new member
  const avatarUrl = fbUser.picture?.data?.url ?? null;
  const [newMember] = await db
    .insert(members)
    .values({
      name: fbUser.name,
      facebookId: fbUser.id,
      avatarUrl,
    })
    .returning();

  await setUserCookie(newMember.id, newMember.facebookId);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
