"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

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
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const rl = await checkRateLimit(`google-login:${ip}`, 10, 5 * 60_000);
  if (!rl.ok) {
    const t = await getTranslations("serverErrors");
    return {
      error: t("tooManyLoginAttempts", { seconds: rl.retryAfter ?? 60 }),
    };
  }

  const claims = await verifyGoogleIdToken(idToken);
  if (!claims) return { error: "Google verification failed" };

  // Find existing member by googleId
  const existing = await db.query.members.findFirst({
    where: eq(members.googleId, claims.sub),
  });

  if (existing) {
    if (!existing.isActive) {
      return { error: "Account deactivated. Contact admin." };
    }

    // Refresh name/avatar/email from Google if changed
    const updates: Partial<typeof members.$inferInsert> = {};
    if (claims.name && existing.name !== claims.name)
      updates.name = claims.name;
    if (claims.picture && existing.avatarUrl !== claims.picture)
      updates.avatarUrl = claims.picture;
    if (claims.email && existing.email !== claims.email)
      updates.email = claims.email;
    if (Object.keys(updates).length > 0) {
      await db.update(members).set(updates).where(eq(members.id, existing.id));
    }

    await setUserCookie(existing.id, `g:${claims.sub}`);
    revalidatePath("/");
    return { success: true, memberName: existing.name };
  }

  // Check if there's an existing member with the same email (e.g., user
  // previously signed in with Facebook, now Google with same Gmail). If so,
  // link Google to the same member instead of creating a duplicate.
  if (claims.email) {
    const byEmail = await db.query.members.findFirst({
      where: eq(members.email, claims.email),
    });
    if (byEmail && byEmail.isActive) {
      await db
        .update(members)
        .set({
          googleId: claims.sub,
          avatarUrl: byEmail.avatarUrl ?? claims.picture ?? null,
        })
        .where(eq(members.id, byEmail.id));
      await setUserCookie(byEmail.id, `g:${claims.sub}`);
      revalidatePath("/");
      return { success: true, memberName: byEmail.name };
    }
  }

  // Create new member — pending admin approval. Khác với member admin tạo
  // trực tiếp (mặc định approved): OAuth signup phải qua approval flow.
  const [newMember] = await db
    .insert(members)
    .values({
      name: claims.name ?? "Google user",
      googleId: claims.sub,
      email: claims.email ?? null,
      avatarUrl: claims.picture ?? null,
      approvalStatus: "pending",
    })
    .returning();

  await setUserCookie(newMember.id, `g:${claims.sub}`);
  revalidatePath("/");
  return { success: true, memberName: newMember.name };
}
