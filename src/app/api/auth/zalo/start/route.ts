import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { isSameOriginRequest } from "@/lib/same-origin";
import { verifyTurnstile } from "@/lib/turnstile";
import { getTrustedClientIp, hashedIpKey } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-next-path";
import { buildZaloAuthorizeUrl, createPkcePair } from "@/lib/zalo-oauth";
import {
  ZALO_STATE_COOKIE,
  ZALO_STATE_COOKIE_OPTS,
  sealZaloState,
} from "@/lib/zalo-oauth-state";
import {
  ZALO_RATE_LIMIT,
  ZALO_RATE_WINDOW_MS,
  cookieSecretOrUndefined,
  loginErrorRedirect,
  missingEnvNames,
  notFoundResponse,
  type ZaloLoginError,
} from "../zalo-route-helpers";

const STATE_MAX_AGE_SEC = 600;

/** Turnstile action của widget trên trang đăng nhập giao lưu. */
const TURNSTILE_ACTION = "zalo_login";

type StartEnv = { appId: string; redirectUri: string; appHostname: string };

function readStartEnv(): StartEnv | null {
  const vars = {
    NEXT_PUBLIC_ZALO_APP_ID: process.env.NEXT_PUBLIC_ZALO_APP_ID,
    ZALO_APP_SECRET: process.env.ZALO_APP_SECRET,
    ZALO_REDIRECT_URI: process.env.ZALO_REDIRECT_URI,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    // Ký cookie state và băm IP đều cần khoá này; thiếu thì sealZaloState ném lỗi.
    USER_COOKIE_SECRET: cookieSecretOrUndefined(),
  };
  const missing = missingEnvNames(vars);
  if (missing.length > 0) {
    console.error("[ZaloAuth] config", { missing });
    return null;
  }
  let appHostname: string;
  try {
    // URL chuẩn hoá hostname về chữ thường và bỏ cổng, đúng dạng Cloudflare trả.
    appHostname = new URL(vars.NEXT_PUBLIC_APP_URL as string).hostname;
  } catch {
    console.error("[ZaloAuth] config", { invalid: ["NEXT_PUBLIC_APP_URL"] });
    return null;
  }
  return {
    appId: vars.NEXT_PUBLIC_ZALO_APP_ID as string,
    redirectUri: vars.ZALO_REDIRECT_URI as string,
    appHostname,
  };
}

async function readForm(request: NextRequest): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    // Body không phải form: coi như form rỗng, Turnstile sẽ từ chối.
    return new FormData();
  }
}

function formString(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" ? v : null;
}

/**
 * Bắt đầu đăng nhập Zalo từ form trên `/giao-luu/dang-nhap`. Luôn là tài khoản
 * `exchange`: không nhận `intent` từ client, để người lạ không tự xếp mình vào
 * hàng chờ duyệt của nhóm.
 *
 * Thứ tự kiểm: cờ → Origin → env → Turnstile → rate limit. Rate limit ghi DB
 * nên đứng sau Turnstile, để request chưa qua captcha không ghi được gì.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isExchangeEnabled())) return notFoundResponse();

  const form = await readForm(request);
  const next = safeNextPath(formString(form, "next"));
  const fail = (error: ZaloLoginError) =>
    loginErrorRedirect(request, error, next);

  if (!isSameOriginRequest(request, request.nextUrl.origin)) {
    return fail("origin");
  }

  const env = readStartEnv();
  if (!env) return fail("config");

  try {
    const ip = await getTrustedClientIp();
    const captcha = await verifyTurnstile(
      formString(form, "cf-turnstile-response"),
      {
        action: TURNSTILE_ACTION,
        remoteIp: ip !== "unknown" ? ip : undefined,
        expectedHostname: env.appHostname,
      },
    );
    if (!captcha.ok) return fail("captcha");

    const rl = await checkRateLimit(
      `zalo-start:${hashedIpKey(ip)}`,
      ZALO_RATE_LIMIT,
      ZALO_RATE_WINDOW_MS,
    );
    if (!rl.ok) return fail("rate");

    const { verifier, challenge } = createPkcePair();
    const state = randomBytes(32).toString("base64url");
    const sealed = sealZaloState({
      state,
      verifier,
      intent: "exchange",
      next,
      iat: Date.now(),
    });

    const res = NextResponse.redirect(
      buildZaloAuthorizeUrl({
        appId: env.appId,
        redirectUri: env.redirectUri,
        challenge,
        state,
      }),
      303,
    );
    res.cookies.set(ZALO_STATE_COOKIE, sealed, {
      ...ZALO_STATE_COOKIE_OPTS,
      maxAge: STATE_MAX_AGE_SEC,
    });
    return res;
  } catch {
    // Chỉ còn lỗi DB của rate limit. Không log error object.
    console.error("[ZaloAuth] server");
    return fail("server");
  }
}
