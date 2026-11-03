import { describe, expect, it, vi } from "vitest";
import {
  buildZaloAuthorizeUrl,
  createPkcePair,
  exchangeZaloCode,
  fetchZaloProfile,
  pkceChallenge,
} from "./zalo-oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PKCE", () => {
  it("pkceChallenge khớp vector RFC 7636", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("verifier dài 43, chỉ chữ và số, challenge khớp verifier", () => {
    const a = createPkcePair();
    const b = createPkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).toBe(pkceChallenge(a.verifier));
  });
});

describe("buildZaloAuthorizeUrl", () => {
  it("encode redirect_uri và đủ 4 tham số", () => {
    const url = buildZaloAuthorizeUrl({
      appId: "123",
      redirectUri: "https://example.com/api/auth/zalo/callback?a=b&c=d",
      challenge: "chal-_",
      state: "st4te",
    });
    expect(url.startsWith("https://oauth.zaloapp.com/v4/permission?")).toBe(
      true,
    );
    const u = new URL(url);
    expect([...u.searchParams.keys()].sort()).toEqual([
      "app_id",
      "code_challenge",
      "redirect_uri",
      "state",
    ]);
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://example.com/api/auth/zalo/callback?a=b&c=d",
    );
    expect(url).toContain(
      "redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fauth%2Fzalo%2Fcallback%3Fa%3Db%26c%3Dd",
    );
  });
});

describe("exchangeZaloCode", () => {
  const p = { appId: "app1", secret: "sec", code: "co de", verifier: "ver" };

  it("gửi header secret_key và body đúng, trả accessToken", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: "AT",
        refresh_token: "r",
        expires_in: "3600",
      }),
    );
    expect(await exchangeZaloCode(p, f)).toEqual({ accessToken: "AT" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://oauth.zaloapp.com/v4/access_token");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("secret_key")).toBe("sec");
    expect(headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      code: "co de",
      app_id: "app1",
      grant_type: "authorization_code",
      code_verifier: "ver",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["HTTP lỗi", () => jsonResponse({ access_token: "AT" }, 500)],
    ["JSON có error", () => jsonResponse({ error: -14, error_name: "x" })],
    [
      "JSON có error kèm access_token",
      () => jsonResponse({ error: -14, access_token: "AT" }),
    ],
    ["thiếu access_token", () => jsonResponse({ refresh_token: "r" })],
    ["access_token rỗng", () => jsonResponse({ access_token: "" })],
    ["body không phải JSON", () => new Response("<html>", { status: 200 })],
  ])("%s -> exchange", async (_n, make) => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(make());
    expect(await exchangeZaloCode(p, f)).toEqual({ error: "exchange" });
  });

  it("fetch ném lỗi hay quá 5s -> exchange", async () => {
    const boom = vi.fn<typeof fetch>().mockRejectedValue(new Error("net"));
    expect(await exchangeZaloCode(p, boom)).toEqual({ error: "exchange" });
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect(await exchangeZaloCode(p, timeout)).toEqual({ error: "exchange" });
  });
});

describe("fetchZaloProfile", () => {
  it("uid là chuỗi kể cả khi id là số, gửi header access_token", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          '{"id":1234567890123456789,"name":"An","picture":{"data":{"url":"https://s.zdn.vn/a.jpg"}}}',
        ),
      );
    const res = await fetchZaloProfile("AT", f);
    expect(res).toEqual({
      uid: "1234567890123456789",
      name: "An",
      pictureUrl: "https://s.zdn.vn/a.jpg",
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://graph.zalo.me/v2.0/me?fields=id,name,picture");
    expect(new Headers(init?.headers).get("access_token")).toBe("AT");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("id dạng chuỗi 19 chữ số giữ nguyên từng chữ số", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ id: "1234567890123456789", name: "An" }),
      );
    expect(await fetchZaloProfile("AT", f)).toMatchObject({
      uid: "1234567890123456789",
    });
  });

  it("-501 -> region", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: -501, message: "ip" }));
    expect(await fetchZaloProfile("AT", f)).toEqual({ error: "region" });
  });

  it.each([
    ["lỗi khác", () => jsonResponse({ error: -216, message: "bad" })],
    ["HTTP lỗi", () => jsonResponse({ id: "1", name: "A" }, 500)],
    ["thiếu id", () => jsonResponse({ name: "A" })],
    ["body hỏng", () => new Response("nope")],
  ])("%s -> profile", async (_n, make) => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(make());
    expect(await fetchZaloProfile("AT", f)).toEqual({ error: "profile" });
  });

  it("fetch ném lỗi hay quá 5s -> profile", async () => {
    const boom = vi.fn<typeof fetch>().mockRejectedValue(new Error("net"));
    expect(await fetchZaloProfile("AT", boom)).toEqual({ error: "profile" });
    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect(await fetchZaloProfile("AT", timeout)).toEqual({ error: "profile" });
  });

  it('name rỗng -> "Zalo user"', async () => {
    for (const name of ["", "   ", undefined]) {
      const f = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: "9", name }));
      expect(await fetchZaloProfile("AT", f)).toMatchObject({
        name: "Zalo user",
      });
    }
  });

  it("picture không phải https -> null", async () => {
    for (const url of ["http://x/a.jpg", "javascript:alert(1)", "data:x", 5]) {
      const f = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ id: "9", name: "A", picture: { data: { url } } }),
        );
      expect(await fetchZaloProfile("AT", f)).toMatchObject({
        pictureUrl: null,
      });
    }
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: "9", name: "A" }));
    expect(await fetchZaloProfile("AT", f)).toMatchObject({ pictureUrl: null });
  });
});
