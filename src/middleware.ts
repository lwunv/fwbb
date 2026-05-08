import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET_RAW = process.env.JWT_SECRET;
const JWT_SECRET = JWT_SECRET_RAW
  ? new TextEncoder().encode(JWT_SECRET_RAW)
  : null;
const ADMIN_COOKIE = "fwbb-admin-token";

/** Auth-gate cho mọi `/admin/*` trừ `/admin/login`. Request thiếu/hỏng cookie
 *  bị 302 về /admin/login TRƯỚC khi tới layout/page → ngăn PII leak qua RSC
 *  payload (member rows chứa bankAccountNo / email / facebookId). */
async function isValidAdmin(token: string | undefined): Promise<boolean> {
  if (!token || !JWT_SECRET) return false;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload?.role === "admin";
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Login page bypass — admin must be able to reach it without a cookie.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return NextResponse.next();
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    const ok = await isValidAdmin(token);
    if (!ok) {
      const loginUrl = new URL("/admin/login", req.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
