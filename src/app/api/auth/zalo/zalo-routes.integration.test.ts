/**
 * Luồng OAuth Zalo qua hai route handler thật: `start` (POST từ form đăng
 * nhập) và `callback` (Zalo chuyển hướng về). Gọi thẳng POST/GET với
 * NextRequest thật, DB test thật; chỉ mạng (Cloudflare, Zalo) và
 * `next/headers` là giả. Khoá lại thứ tự kiểm (cờ → Origin → env → Turnstile →
 * rate limit), state chỉ dùng được một lần, và cookie state luôn bị xoá ở
 * callback dù kết quả ra sao.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities, rateLimitBuckets } from "@/db/schema";
import type { ZaloOAuthState } from "@/lib/zalo-oauth-state";

const ctx = vi.hoisted(() => ({
  headers: new Headers(),
  cookieOps: [] as Array<{ op: "set" | "delete"; args: unknown[] }>,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ctx.headers),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: (...args: unknown[]) => {
      ctx.cookieOps.push({ op: "set", args });
    },
    delete: (...args: unknown[]) => {
      ctx.cookieOps.push({ op: "delete", args });
    },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { POST } = await import("./start/route");
const { GET } = await import("./callback/route");
const { updateSetting } = await import("@/actions/settings");
const { sealZaloState, openZaloState, ZALO_STATE_COOKIE } =
  await import("@/lib/zalo-oauth-state");
const { pkceChallenge } = await import("@/lib/zalo-oauth");
const { hashedIpKey } = await import("@/lib/client-ip");
const { parseUserCookie } = await import("@/lib/user-identity");

const ORIGIN = "http://localhost:3101";
const IP = "203.0.113.7";
const UID = "1234567890123456789"; // > 2^53: phải giữ nguyên từng chữ số
const PIC = "https://s120-ava-talk.zadn.vn/a/b/c.jpg";
const STATE_COOKIE_PATH = "/api/auth/zalo";

const ENV = {
  NEXT_PUBLIC_ZALO_APP_ID: "1049980137651781495",
  ZALO_APP_SECRET: "zalo-secret-test",
  ZALO_REDIRECT_URI: `${ORIGIN}/api/auth/zalo/callback`,
  // Không phải secret giả của Cloudflare, để action/hostname thật sự được so.
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA-test-secret",
  NEXT_PUBLIC_APP_URL: ORIGIN,
} as const;

// --- mạng giả -------------------------------------------------------------

type Reply = { status?: number; body: unknown } | Error;
const replies: { turnstile: Reply; token: Reply; profile: Reply } = {
  turnstile: { body: {} },
  token: { body: {} },
  profile: { body: {} },
};

function defaultReplies() {
  replies.turnstile = {
    body: { success: true, action: "exchange_login", hostname: "localhost" },
  };
  replies.token = {
    body: { access_token: "zalo-access-token", expires_in: "3600" },
  };
  // id dạng số thô như Zalo trả.
  replies.profile = {
    body: `{"id":${UID},"name":"Lan Anh","picture":{"data":{"url":"${PIC}"}}}`,
  };
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  let r: Reply;
  if (url.startsWith("https://challenges.cloudflare.com/"))
    r = replies.turnstile;
  else if (url.startsWith("https://oauth.zaloapp.com/v4/access_token"))
    r = replies.token;
  else if (url.startsWith("https://graph.zalo.me/")) r = replies.profile;
  else throw new Error("unexpected fetch");
  if (r instanceof Error) throw r;
  return new Response(
    typeof r.body === "string" ? r.body : JSON.stringify(r.body),
    {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    },
  );
});

function callsTo(prefix: string): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.startsWith(prefix);
  }).length;
}
const TOKEN_URL = "https://oauth.zaloapp.com/v4/access_token";

// --- dựng request ---------------------------------------------------------

function startRequest(
  opts: {
    origin?: string | null;
    token?: string | null;
    next?: string;
  } = {},
): NextRequest {
  const h = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    "x-real-ip": IP,
  });
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) h.set("origin", origin);
  const form = new URLSearchParams();
  const token = opts.token === undefined ? "cf-token-ok" : opts.token;
  if (token !== null) form.set("cf-turnstile-response", token);
  if (opts.next !== undefined) form.set("next", opts.next);
  ctx.headers = h;
  return new NextRequest(`${ORIGIN}/api/auth/zalo/start`, {
    method: "POST",
    headers: h,
    body: form.toString(),
  });
}

function callbackRequest(
  query: Record<string, string>,
  cookie: string | null,
): NextRequest {
  const h = new Headers({ "x-real-ip": IP });
  if (cookie !== null) h.set("cookie", `${ZALO_STATE_COOKIE}=${cookie}`);
  ctx.headers = h;
  const qs = new URLSearchParams(query).toString();
  return new NextRequest(`${ORIGIN}/api/auth/zalo/callback?${qs}`, {
    headers: h,
  });
}

function sealedState(over: Partial<ZaloOAuthState> = {}) {
  const st: ZaloOAuthState = {
    state: "state-0123456789abcdef",
    verifier: "V".repeat(43),
    intent: "exchange",
    next: "/exchanges/lich",
    iat: Date.now(),
    ...over,
  };
  return { st, cookie: sealZaloState(st) };
}

// --- kiểm response --------------------------------------------------------

function expectLoginError(res: Response, code: string, next = "/exchanges") {
  expect(res.status).toBe(303);
  const loc = new URL(res.headers.get("location") ?? "");
  expect(loc.origin).toBe(ORIGIN);
  expect(loc.pathname).toBe("/exchanges/login");
  expect(loc.searchParams.get("error")).toBe(code);
  expect(loc.searchParams.get("next")).toBe(next);
}

function stateSetCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => c.startsWith(`${ZALO_STATE_COOKIE}=`));
}

function expectStateCookieCleared(res: Response) {
  const list = stateSetCookies(res);
  expect(list).toHaveLength(1);
  const c = list[0];
  expect(c.startsWith(`${ZALO_STATE_COOKIE}=;`)).toBe(true);
  expect(c).toContain(`Path=${STATE_COOKIE_PATH}`);
  expect(c).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
}

function userCookieSets() {
  return ctx.cookieOps.filter(
    (o) => o.op === "set" && o.args[0] === "fwbb-user",
  );
}

async function bucketKeys(): Promise<string[]> {
  const rows = await testDb
    .select({ key: rateLimitBuckets.key })
    .from(rateLimitBuckets);
  return rows.map((r) => r.key);
}

async function memberCount(): Promise<number> {
  return (await testDb.select({ id: members.id }).from(members)).length;
}

// --- vòng đời test --------------------------------------------------------

const ENV_KEYS = [...Object.keys(ENV), "USER_COOKIE_SECRET"];
let savedEnv: Record<string, string | undefined> = {};
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  await client.execute("DROP TRIGGER IF EXISTS zalo_member_boom");
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
  await client.execute("DELETE FROM app_settings");
  await updateSetting("exchangeEnabled", true);
  ctx.cookieOps.length = 0;
  defaultReplies();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

// --- cờ -------------------------------------------------------------------

describe("cờ exchangeEnabled tắt", () => {
  it("start 404, callback 404, không gọi mạng, không đụng DB", async () => {
    await updateSetting("exchangeEnabled", false);
    const { st, cookie } = sealedState();

    const s = await POST(startRequest());
    const c = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );

    expect(s.status).toBe(404);
    expect(c.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await bucketKeys()).toEqual([]);
  });
});

// --- start ----------------------------------------------------------------

describe("POST /api/auth/zalo/start", () => {
  it("Origin https://evil.com → error=origin, không gọi fetch, không cookie, không ghi DB", async () => {
    const res = await POST(
      startRequest({ origin: "https://evil.com", next: "/exchanges/lich" }),
    );
    expectLoginError(res, "origin", "/exchanges/lich");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateSetCookies(res)).toEqual([]);
    expect(await bucketKeys()).toEqual([]);
  });

  it('Origin "null" → error=origin', async () => {
    expectLoginError(await POST(startRequest({ origin: "null" })), "origin");
  });

  it.each([
    "NEXT_PUBLIC_ZALO_APP_ID",
    "ZALO_APP_SECRET",
    "ZALO_REDIRECT_URI",
    "TURNSTILE_SECRET_KEY",
    "NEXT_PUBLIC_APP_URL",
    "USER_COOKIE_SECRET",
  ])("thiếu %s → error=config, không cookie, không gọi mạng", async (name) => {
    delete process.env[name];
    const res = await POST(startRequest());
    expectLoginError(res, "config");
    expect(stateSetCookies(res)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await bucketKeys()).toEqual([]);
    // Log tên biến, không log giá trị.
    expect(consoleError).toHaveBeenCalledWith("[ZaloAuth] config", {
      missing: [name],
    });
  });

  it("NEXT_PUBLIC_APP_URL không parse được → error=config", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "not a url";
    expectLoginError(await POST(startRequest()), "config");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("thiếu token Turnstile → error=captcha, rate_limit_buckets rỗng", async () => {
    const res = await POST(startRequest({ token: null }));
    expectLoginError(res, "captcha");
    expect(stateSetCookies(res)).toEqual([]);
    expect(await bucketKeys()).toEqual([]);
  });

  it("Cloudflare không gọi được → error=captcha (fail-closed)", async () => {
    replies.turnstile = new Error("network down");
    const res = await POST(startRequest());
    expectLoginError(res, "captcha");
    expect(await bucketKeys()).toEqual([]);
  });

  it("Turnstile hợp lệ cho hostname khác → error=captcha", async () => {
    replies.turnstile = {
      body: { success: true, action: "exchange_login", hostname: "evil.com" },
    };
    expectLoginError(await POST(startRequest()), "captcha");
  });

  it("gửi Cloudflare đúng remoteip tin cậy", async () => {
    await POST(startRequest());
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new URLSearchParams(String(init.body)).get("remoteip")).toBe(IP);
  });

  it("hợp lệ → 303 tới Zalo với redirect_uri đúng ZALO_REDIRECT_URI; cookie state đúng thuộc tính", async () => {
    const res = await POST(startRequest({ next: "/exchanges/lich" }));

    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin + loc.pathname).toBe(
      "https://oauth.zaloapp.com/v4/permission",
    );
    expect(loc.searchParams.get("redirect_uri")).toBe(ENV.ZALO_REDIRECT_URI);
    expect(loc.searchParams.get("app_id")).toBe(ENV.NEXT_PUBLIC_ZALO_APP_ID);

    const c = (res as NextResponseLike).cookies.get(ZALO_STATE_COOKIE);
    expect(c).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: STATE_COOKIE_PATH,
      maxAge: 600,
    });

    const st = openZaloState(c?.value);
    expect(st).not.toBeNull();
    expect(st?.intent).toBe("exchange");
    expect(st?.next).toBe("/exchanges/lich");
    expect(loc.searchParams.get("state")).toBe(st?.state);
    expect(loc.searchParams.get("code_challenge")).toBe(
      pkceChallenge(st?.verifier ?? ""),
    );
  });

  it("khoá rate limit trong DB là hash, không chứa chuỗi IP 203.0.113.7", async () => {
    await POST(startRequest());
    const keys = await bucketKeys();
    expect(keys).toEqual([`zalo-start:${hashedIpKey(IP)}`]);
    expect(keys.join("|")).not.toContain(IP);
  });

  it("quá 10 lần / 5 phút → error=rate, không cookie", async () => {
    await testDb.insert(rateLimitBuckets).values({
      key: `zalo-start:${hashedIpKey(IP)}`,
      count: 10,
      resetAt: Date.now() + 60_000,
    });
    const res = await POST(startRequest());
    expectLoginError(res, "rate");
    expect(stateSetCookies(res)).toEqual([]);
  });

  it("next=//evil.com → state lưu next=/exchanges", async () => {
    const res = await POST(startRequest({ next: "//evil.com" }));
    const c = (res as NextResponseLike).cookies.get(ZALO_STATE_COOKIE);
    expect(openZaloState(c?.value)?.next).toBe("/exchanges");
  });
});

type NextResponseLike = Response & {
  cookies: {
    get(
      name: string,
    ): ({ value: string } & Record<string, unknown>) | undefined;
  };
};

// --- callback -------------------------------------------------------------

describe("GET /api/auth/zalo/callback", () => {
  it("không cookie → error=state, không gọi Zalo, vẫn xoá cookie state", async () => {
    const res = await GET(callbackRequest({ code: "c", state: "x" }, null));
    expectLoginError(res, "state");
    expect(fetchMock).not.toHaveBeenCalled();
    expectStateCookieCleared(res);
  });

  it("cookie bị sửa (sai chữ ký) → error=state", async () => {
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest(
        { code: "c", state: st.state },
        cookie.slice(0, -2) + "00",
      ),
    );
    expectLoginError(res, "state");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("state lệch → error=state, không có dòng zalo-state", async () => {
    const { cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: "state-khac-hoan-toan" }, cookie),
    );
    expectLoginError(res, "state");
    expectStateCookieCleared(res);
    expect(
      (await bucketKeys()).filter((k) => k.startsWith("zalo-state:")),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("thiếu env (ZALO_APP_SECRET / USER_COOKIE_SECRET) → error=config, không phải state", async () => {
    const { st, cookie } = sealedState();
    for (const name of ["ZALO_APP_SECRET", "USER_COOKIE_SECRET"]) {
      Object.assign(process.env, ENV);
      process.env.USER_COOKIE_SECRET = savedEnv.USER_COOKIE_SECRET;
      delete process.env[name];
      const res = await GET(
        callbackRequest({ code: "c", state: st.state }, cookie),
      );
      expectLoginError(res, "config");
      expectStateCookieCleared(res);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await bucketKeys()).toEqual([]);
  });

  it("state được giành một lần: khoá zalo-state:<sha256>, resetAt = iat + 10 phút", async () => {
    const { st, cookie } = sealedState();
    await GET(callbackRequest({ code: "c", state: st.state }, cookie));
    const key = `zalo-state:${createHash("sha256").update(st.state).digest("hex")}`;
    const row = await testDb.query.rateLimitBuckets.findFirst({
      where: eq(rateLimitBuckets.key, key),
    });
    expect(row).toMatchObject({ count: 1, resetAt: st.iat + 600_000 });
  });

  it("gọi 2 lần cùng cookie + state → lần 2 error=state, chỉ 1 lần exchange, chỉ 1 member", async () => {
    const { st, cookie } = sealedState();
    const first = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    const second = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );

    expect(first.status).toBe(303);
    expect(new URL(first.headers.get("location") ?? "").pathname).toBe(
      "/exchanges/lich",
    );
    expectLoginError(second, "state", "/exchanges/lich");
    expectStateCookieCleared(second);
    expect(callsTo(TOKEN_URL)).toBe(1);
    expect(await memberCount()).toBe(1);
    expect(userCookieSets()).toHaveLength(1);
  });

  it("không có code → error=denied", async () => {
    const { st, cookie } = sealedState();
    const res = await GET(callbackRequest({ state: st.state }, cookie));
    expectLoginError(res, "denied", "/exchanges/lich");
    expectStateCookieCleared(res);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Zalo gửi error=access_denied → error=denied", async () => {
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest(
        { code: "c", state: st.state, error: "access_denied" },
        cookie,
      ),
    );
    expectLoginError(res, "denied", "/exchanges/lich");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quá 10 lần / 5 phút → error=rate", async () => {
    await testDb.insert(rateLimitBuckets).values({
      key: `zalo-callback:${hashedIpKey(IP)}`,
      count: 10,
      resetAt: Date.now() + 60_000,
    });
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expectLoginError(res, "rate", "/exchanges/lich");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch Zalo ném lỗi → error=exchange, không 500", async () => {
    replies.token = new Error("socket hang up");
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expectLoginError(res, "exchange", "/exchanges/lich");
    expectStateCookieCleared(res);
    expect(userCookieSets()).toEqual([]);
  });

  it("Zalo -501 → error=region", async () => {
    replies.profile = { body: { error: -501, message: "IP not in VN" } };
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expectLoginError(res, "region", "/exchanges/lich");
    expect(await memberCount()).toBe(0);
  });

  it("hồ sơ Zalo lỗi khác → error=profile", async () => {
    replies.profile = { body: { error: 452, message: "invalid token" } };
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expectLoginError(res, "profile", "/exchanges/lich");
  });

  it("loginOrCreateZaloMember ném lỗi → error=server, không setUserCookie, log không lộ dữ liệu Zalo", async () => {
    await client.execute(
      "CREATE TRIGGER zalo_member_boom BEFORE INSERT ON members BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );

    expectLoginError(res, "server", "/exchanges/lich");
    expectStateCookieCleared(res);
    expect(userCookieSets()).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith("[ZaloAuth] server");
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(UID);
    expect(logged).not.toContain("Lan Anh");
    expect(logged).not.toContain("boom");
  });

  it("member bị khoá → error=blocked, không setUserCookie", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Bị khoá", approvalStatus: "approved", isActive: false })
      .returning();
    await testDb
      .insert(memberOauthIdentities)
      .values({ memberId: m.id, provider: "zalo", providerUid: UID });

    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expectLoginError(res, "blocked", "/exchanges/lich");
    expectStateCookieCleared(res);
    expect(userCookieSets()).toEqual([]);
  });

  it("thành công → setUserCookie(zalo:<uid>), 303 tới next, xoá cookie state", async () => {
    const { st, cookie } = sealedState();
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/exchanges/lich`);
    expectStateCookieCleared(res);

    const sets = userCookieSets();
    expect(sets).toHaveLength(1);
    const parsed = parseUserCookie(String(sets[0].args[1]));
    expect(parsed?.externalId).toBe(`zalo:${UID}`);

    const identity = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, UID),
    });
    expect(parsed?.memberId).toBe(identity?.memberId);
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, identity?.memberId ?? -1),
    });
    expect(m).toMatchObject({
      approvalStatus: "pending",
      signupIntent: "exchange",
    });
  });

  it("next trong state vẫn đi qua safeNextPath lúc redirect", async () => {
    const { st, cookie } = sealedState({ next: "//evil.com" });
    const res = await GET(
      callbackRequest({ code: "c", state: st.state }, cookie),
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/exchanges`);
  });
});

describe("start → callback trọn vòng", () => {
  it("cookie và state từ start dùng được ở callback, verifier PKCE gửi đúng", async () => {
    const s = await POST(startRequest({ next: "/exchanges/lich" }));
    const c = (s as NextResponseLike).cookies.get(ZALO_STATE_COOKIE);
    const state = new URL(s.headers.get("location") ?? "").searchParams.get(
      "state",
    );
    const verifier = openZaloState(c?.value)?.verifier;

    const res = await GET(
      callbackRequest(
        { code: "zalo-code", state: state ?? "" },
        c?.value ?? null,
      ),
    );
    expect(res.headers.get("location")).toBe(`${ORIGIN}/exchanges/lich`);

    const tokenCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith(TOKEN_URL),
    ) as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(tokenCall[1].body));
    expect(body.get("code")).toBe("zalo-code");
    expect(body.get("code_verifier")).toBe(verifier);
  });
});
