import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { rateLimitBuckets } from "@/db/schema";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { getTrustedClientIp, hashedIpKey } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-next-path";
import { exchangeZaloCode, fetchZaloProfile } from "@/lib/zalo-oauth";
import {
  ZALO_STATE_COOKIE,
  ZALO_STATE_COOKIE_OPTS,
  openZaloState,
  statesMatch,
  type ZaloOAuthState,
} from "@/lib/zalo-oauth-state";
import { loginOrCreateZaloMember } from "@/lib/zalo-login";
import { setUserCookie } from "@/lib/user-identity";
import {
  ZALO_RATE_LIMIT,
  ZALO_RATE_WINDOW_MS,
  cookieSecretOrUndefined,
  loginErrorRedirect,
  missingEnvNames,
  notFoundResponse,
  type ZaloLoginError,
} from "../zalo-route-helpers";

/** Bằng tuổi thọ cookie state: quá mốc này openZaloState đã từ chối cookie. */
const STATE_TTL_MS = 600_000;

type CallbackEnv = { appId: string; appSecret: string };

function readCallbackEnv(): CallbackEnv | null {
  const vars = {
    NEXT_PUBLIC_ZALO_APP_ID: process.env.NEXT_PUBLIC_ZALO_APP_ID,
    ZALO_APP_SECRET: process.env.ZALO_APP_SECRET,
    // openZaloState trả null khi thiếu khoá này; kiểm trước để báo `config`
    // thay vì `state` (người dùng không làm gì sai).
    USER_COOKIE_SECRET: cookieSecretOrUndefined(),
  };
  const missing = missingEnvNames(vars);
  if (missing.length > 0) {
    console.error("[ZaloAuth] config", { missing });
    return null;
  }
  return {
    appId: vars.NEXT_PUBLIC_ZALO_APP_ID as string,
    appSecret: vars.ZALO_APP_SECRET as string,
  };
}

/**
 * Giành state đúng một lần. Hai callback cùng state (bấm lại, tab cũ, kẻ chặn
 * được URL) chỉ một cái chèn được dòng; cái kia không có dòng trả về. Ghi DB
 * trước Turnstile là có chủ đích: cookie HMAC hợp lệ chứng minh request này đã
 * qua Turnstile ở `start`. Khoá là hash của state nên DB không giữ state thô.
 */
async function claimState(st: ZaloOAuthState): Promise<boolean> {
  const key = `zalo-state:${createHash("sha256").update(st.state).digest("hex")}`;
  const rows = await db
    .insert(rateLimitBuckets)
    // iat là epoch millis; dòng hết hạn cùng lúc với cookie nên dọn được an toàn.
    .values({ key, count: 1, resetAt: st.iat + STATE_TTL_MS })
    .onConflictDoNothing()
    .returning({ key: rateLimitBuckets.key });
  return rows.length > 0;
}

async function handleCallback(request: NextRequest): Promise<NextResponse> {
  let next: unknown = undefined;
  const fail = (error: ZaloLoginError) =>
    loginErrorRedirect(request, error, next);

  const env = readCallbackEnv();
  if (!env) return fail("config");

  let memberId: number | undefined;
  try {
    const q = request.nextUrl.searchParams;
    const st = openZaloState(request.cookies.get(ZALO_STATE_COOKIE)?.value);
    const returnedState = q.get("state");
    if (
      !st ||
      returnedState === null ||
      !statesMatch(st.state, returnedState)
    ) {
      return fail("state");
    }
    next = st.next;

    if (!(await claimState(st))) return fail("state");

    const ip = await getTrustedClientIp();
    const rl = await checkRateLimit(
      `zalo-callback:${hashedIpKey(ip)}`,
      ZALO_RATE_LIMIT,
      ZALO_RATE_WINDOW_MS,
    );
    if (!rl.ok) return fail("rate");

    const code = q.get("code");
    if (!code || q.get("error")) return fail("denied");

    const token = await exchangeZaloCode({
      appId: env.appId,
      secret: env.appSecret,
      code,
      verifier: st.verifier,
    });
    if ("error" in token) {
      console.error("[ZaloAuth] exchange");
      return fail("exchange");
    }

    const profile = await fetchZaloProfile(token.accessToken);
    if ("error" in profile) {
      console.error(`[ZaloAuth] ${profile.error}`);
      return fail(profile.error);
    }

    const login = await loginOrCreateZaloMember({
      uid: profile.uid,
      name: profile.name,
      pictureUrl: profile.pictureUrl,
      intent: "exchange",
    });
    if ("error" in login) {
      console.error("[ZaloAuth] blocked");
      return fail("blocked");
    }
    memberId = login.memberId;

    await setUserCookie(login.memberId, `zalo:${profile.uid}`);
    return NextResponse.redirect(
      new URL(safeNextPath(st.next), request.nextUrl.origin),
      303,
    );
  } catch {
    // Lỗi DB của drizzle nhúng uid/tên/ảnh Zalo trong message: không bao giờ log err.
    if (memberId === undefined) console.error("[ZaloAuth] server");
    else console.error("[ZaloAuth] server", { memberId });
    return fail("server");
  }
}

/**
 * Zalo chuyển hướng về đây sau khi người dùng đồng ý (hoặc từ chối). Thứ tự:
 * cờ → env → cookie state + so state → giành state một lần → rate limit →
 * code/error → đổi code lấy token → hồ sơ → tìm hoặc tạo member → cookie
 * đăng nhập. Mọi nhánh sau cờ đều xoá cookie state, đúng path của nó.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isExchangeEnabled())) return notFoundResponse();

  const res = await handleCallback(request);
  // Xoá với đúng path: delete(name) trần để Next điền Path=/ nên không xoá được.
  res.cookies.delete({ name: ZALO_STATE_COOKIE, ...ZALO_STATE_COOKIE_OPTS });
  return res;
}
