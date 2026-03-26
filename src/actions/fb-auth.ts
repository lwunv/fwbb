"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";

interface FacebookUserInfo {
  id: string;
  name: string;
  picture?: { data?: { url?: string } };
}

export async function facebookLogin(accessToken: string) {
  // 1. Verify token server-side via Graph API
  let fbUser: FacebookUserInfo;
  try {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,picture.type(large)&access_token=${accessToken}`,
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
      await db.update(members).set({
        name: fbUser.name,
        avatarUrl,
      }).where(eq(members.id, existing.id));
    }

    await setUserCookie(existing.id, existing.facebookId);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // 3. Create new member
  const avatarUrl = fbUser.picture?.data?.url ?? null;
  const [newMember] = await db.insert(members).values({
    name: fbUser.name,
    facebookId: fbUser.id,
    avatarUrl,
  }).returning();

  await setUserCookie(newMember.id, newMember.facebookId);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
