/**
 * Verify Google ID token bằng tokeninfo endpoint (Google check signature, exp,
 * aud, iss giùm). Trả về claims đã verify hoặc null.
 *
 * Tradeoff: 1 network round trip thay vì local JWT verify với jwks. Chấp nhận
 * được — login flow rare, latency không phải concern, tokeninfo là canonical.
 *
 * Dùng chung: member Google SSO (google-auth.ts) VÀ admin Google SSO (auth.ts).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<{
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
