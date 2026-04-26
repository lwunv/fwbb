import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error(
    "JWT_SECRET env var is required and must be at least 32 characters.",
  );
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect all /admin routes except /admin/login
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const token = request.cookies.get("fwbb-admin-token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    try {
      await jwtVerify(token, JWT_SECRET);
    } catch {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
