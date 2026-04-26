import { clearUserCookie } from "@/lib/user-identity";
import { NextResponse, NextRequest } from "next/server";

/**
 * POST /api/reset-identity — clear the user cookie and redirect home.
 *
 * Hardened: always redirect to a same-origin URL derived from the request URL,
 * never trust the Origin/Referer headers (which can be attacker-controlled and
 * would create an open-redirect vector).
 */
export async function POST(request: NextRequest) {
  await clearUserCookie();
  // request.url is set by Next based on the incoming request; new URL("/", base)
  // strips any client-supplied path/search and pins the redirect to the same origin.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
