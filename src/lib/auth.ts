import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error(
    "JWT_SECRET env var is required and must be at least 32 characters. Refusing to start with a weak/missing JWT secret.",
  );
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
const ADMIN_COOKIE = "fwbb-admin-token";

export async function signAdminToken(adminId: number): Promise<string> {
  return new SignJWT({ sub: String(adminId), role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifyAdminToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setAdminCookie(adminId: number) {
  const token = await signAdminToken(adminId);
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function getAdminFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}

export async function requireAdmin(): Promise<
  { admin: import("jose").JWTPayload } | { error: string }
> {
  const admin = await getAdminFromCookie();
  if (!admin || admin.role !== "admin") {
    return { error: "Không có quyền admin" };
  }
  return { admin };
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}
