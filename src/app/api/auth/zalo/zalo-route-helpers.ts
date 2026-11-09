import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-next-path";

/** Mã lỗi trang đăng nhập giao lưu đọc từ `?error=`. Không bao giờ là lỗi thô của Zalo. */
export type ZaloLoginError =
  | "origin"
  | "config"
  | "captcha"
  | "rate"
  | "state"
  | "denied"
  | "exchange"
  | "profile"
  | "region"
  | "blocked"
  | "server";

const LOGIN_PAGE = "/exchanges/login";

/** Cửa sổ rate limit theo IP của cả hai route: 10 lần / 5 phút. */
export const ZALO_RATE_LIMIT = 10;
export const ZALO_RATE_WINDOW_MS = 5 * 60 * 1000;

/** Cờ tắt: trả 404 trơn như thể route chưa từng có. */
export function notFoundResponse(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

/**
 * 303 về trang đăng nhập giao lưu. URL dựng từ origin của chính request (không
 * từ header Host hay NEXT_PUBLIC_APP_URL), và `next` luôn qua safeNextPath.
 */
export function loginErrorRedirect(
  request: NextRequest,
  error: ZaloLoginError,
  next: unknown,
): NextResponse {
  const url = new URL(LOGIN_PAGE, request.nextUrl.origin);
  url.searchParams.set("error", error);
  url.searchParams.set("next", safeNextPath(next));
  return NextResponse.redirect(url, 303);
}

/**
 * Tên các biến env thiếu (rỗng tính là thiếu). Truyền vào giá trị đọc bằng
 * `process.env.TEN_BIEN` viết thẳng: Next chỉ nhúng được NEXT_PUBLIC_* khi
 * tên viết tĩnh, `process.env[name]` động thì không.
 */
export function missingEnvNames(
  vars: Record<string, string | undefined>,
): string[] {
  return Object.entries(vars)
    .filter(([, v]) => !v || !v.trim())
    .map(([k]) => k);
}

/** USER_COOKIE_SECRET ngắn hơn 16 ký tự bị coi như thiếu (cùng ngưỡng với chỗ ký cookie). */
export function cookieSecretOrUndefined(): string | undefined {
  const s = process.env.USER_COOKIE_SECRET;
  return s && s.length >= 16 ? s : undefined;
}
