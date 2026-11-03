import { afterEach, describe, expect, it, vi } from "vitest";
import { SITEVERIFY_URL, verifyTurnstile } from "./turnstile";

const REAL_SECRET = "0x4AAAAAAA-real-looking-secret";
const DUMMY_PASS_SECRET = "1x0000000000000000000000000000000AA";

afterEach(() => {
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(secret: string | null = REAL_SECRET) {
  if (secret === null) vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  else vi.stubEnv("TURNSTILE_SECRET_KEY", secret);
  return vi.fn<typeof fetch>();
}

describe("verifyTurnstile", () => {
  it("token rỗng, null hay undefined -> missing, không gọi fetch", async () => {
    const f = setup();
    for (const t of ["", "   ", null, undefined]) {
      expect(await verifyTurnstile(t, { action: "login" }, f)).toEqual({
        ok: false,
        reason: "missing",
      });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("token dài hơn 2048 ký tự -> invalid, không gọi fetch", async () => {
    const f = setup();
    const res = await verifyTurnstile("x".repeat(2049), { action: "login" }, f);
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(f).not.toHaveBeenCalled();
  });

  it("token đúng 2048 ký tự vẫn được gửi đi", async () => {
    const f = setup();
    f.mockResolvedValue(
      jsonResponse({ success: true, action: "login", hostname: "a.com" }),
    );
    const res = await verifyTurnstile("x".repeat(2048), { action: "login" }, f);
    expect(res).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("thiếu TURNSTILE_SECRET_KEY -> misconfigured, không gọi fetch", async () => {
    const f = setup(null);
    const res = await verifyTurnstile("tok", { action: "login" }, f);
    expect(res).toEqual({ ok: false, reason: "misconfigured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("success, action và hostname khớp -> ok; gửi secret/response/remoteip dạng form", async () => {
    const f = setup();
    f.mockResolvedValue(
      jsonResponse({
        success: true,
        action: "zalo_login",
        hostname: "fwbb.example",
        "error-codes": [],
      }),
    );
    const res = await verifyTurnstile(
      "tok-1",
      {
        action: "zalo_login",
        remoteIp: "203.0.113.9",
        expectedHostname: "fwbb.example",
      },
      f,
    );
    expect(res).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("secret")).toBe(REAL_SECRET);
    expect(body.get("response")).toBe("tok-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("IP là 'unknown' hoặc không có -> không gửi remoteip", async () => {
    const f = setup();
    f.mockImplementation(async () =>
      jsonResponse({ success: true, action: "login" }),
    );
    await verifyTurnstile("t", { action: "login", remoteIp: "unknown" }, f);
    await verifyTurnstile("t", { action: "login" }, f);
    expect(f).toHaveBeenCalledTimes(2);
    for (const call of f.mock.calls) {
      expect(new URLSearchParams(String(call[1]?.body)).has("remoteip")).toBe(
        false,
      );
    }
  });

  it("success nhưng action khác -> invalid", async () => {
    const f = setup();
    f.mockResolvedValue(jsonResponse({ success: true, action: "other" }));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("success nhưng Cloudflare không trả action -> invalid", async () => {
    const f = setup();
    f.mockResolvedValue(jsonResponse({ success: true }));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("hostname khác expectedHostname -> invalid", async () => {
    const f = setup();
    f.mockResolvedValue(
      jsonResponse({ success: true, action: "login", hostname: "evil.test" }),
    );
    expect(
      await verifyTurnstile(
        "t",
        { action: "login", expectedHostname: "fwbb.example" },
        f,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("không đặt expectedHostname -> không so hostname", async () => {
    const f = setup();
    f.mockResolvedValue(
      jsonResponse({ success: true, action: "login", hostname: "anything" }),
    );
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: true,
    });
  });

  it("success=false (timeout-or-duplicate) -> invalid", async () => {
    const f = setup();
    f.mockResolvedValue(
      jsonResponse({ success: false, "error-codes": ["timeout-or-duplicate"] }),
    );
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("fetch ném lỗi -> unavailable", async () => {
    const f = setup();
    f.mockRejectedValue(new TypeError("network down"));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("quá 5 giây (signal timeout huỷ fetch) -> unavailable", async () => {
    const f = setup();
    f.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("HTTP 500 -> unavailable", async () => {
    const f = setup();
    f.mockResolvedValue(jsonResponse({ success: true }, 500));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("body không phải JSON -> unavailable", async () => {
    const f = setup();
    f.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("body JSON nhưng không phải object -> unavailable", async () => {
    const f = setup();
    f.mockResolvedValue(jsonResponse(null));
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("secret là khoá test của Cloudflare -> bỏ qua so action/hostname", async () => {
    const f = setup(DUMMY_PASS_SECRET);
    f.mockResolvedValue(
      jsonResponse({ success: true, action: "test", hostname: "example.com" }),
    );
    expect(
      await verifyTurnstile(
        "t",
        { action: "zalo_login", expectedHostname: "fwbb.example" },
        f,
      ),
    ).toEqual({ ok: true });
  });

  it("khoá test nhưng success=false vẫn bị từ chối", async () => {
    const f = setup("2x0000000000000000000000000000000AA");
    f.mockResolvedValue(
      jsonResponse({
        success: false,
        "error-codes": ["invalid-input-response"],
      }),
    );
    expect(await verifyTurnstile("t", { action: "login" }, f)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
