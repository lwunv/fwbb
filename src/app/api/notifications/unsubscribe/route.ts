import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPrefs } from "@/db/schema";

// Dạng token do newUnsubToken() sinh: 32 byte base64url = 43 ký tự.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Huỷ nhận email một chạm (RFC 8058) và nút trên trang /unsubscribe.
 * Mail client gọi thẳng nên không có cookie đăng nhập và không kiểm Origin:
 * quyền nằm ở chính token ngẫu nhiên trong URL. Chỉ tắt email, thông báo
 * trên chuông giữ nguyên. Lặp lại an toàn (đặt cờ về false). Không log token.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN_SHAPE.test(token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  try {
    const updated = await db
      .update(notificationPrefs)
      .set({ emailEnabled: false, updatedAt: new Date().toISOString() })
      .where(eq(notificationPrefs.unsubToken, token))
      .returning({ id: notificationPrefs.id });
    if (updated.length === 0) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch {
    console.error("[Notify] unsubscribe_failed");
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}

/**
 * GET không đổi gì (máy quét link trong mail hay mở trước). Mail client không
 * làm POST một chạm thì mở link này trong trình duyệt: chuyển (303) sang trang
 * xác nhận /unsubscribe, ở đó người nhận tự bấm nút.
 */
export function GET(request: NextRequest): NextResponse {
  const target = new URL("/unsubscribe", request.nextUrl.origin);
  const token = request.nextUrl.searchParams.get("token");
  if (token) target.searchParams.set("token", token);
  return NextResponse.redirect(target, 303);
}
