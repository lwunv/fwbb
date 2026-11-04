import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { emailHash, openVerifyToken } from "@/lib/notifications/tokens";

function back(request: NextRequest, result: "verified" | "invalid") {
  return NextResponse.redirect(
    new URL(`/me?email=${result}`, request.nextUrl.origin),
    303,
  );
}

/**
 * Link trong mail xác minh. Chỉ xác minh khi băm email trong token khớp email
 * HIỆN TẠI của member: member đã đổi email sau khi xin link thì link vô hiệu.
 * Không đọc cookie đăng nhập: mở link trên máy khác vẫn xác minh được.
 * Không log token hay email.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const opened = openVerifyToken(token);
  if (!opened) return back(request, "invalid");
  try {
    const [m] = await db
      .select({ email: members.email })
      .from(members)
      .where(eq(members.id, opened.mid))
      .limit(1);
    const email = m?.email?.trim();
    if (!email || emailHash(email) !== opened.eh) {
      return back(request, "invalid");
    }
    await db
      .update(members)
      .set({ notifyEmailVerifiedFor: email.toLowerCase() })
      .where(eq(members.id, opened.mid));
    return back(request, "verified");
  } catch {
    console.error("[Notify] verify_email_failed");
    return back(request, "invalid");
  }
}
