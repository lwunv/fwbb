/**
 * Characterization (03/11/2026, trước g2a): ghim hành vi đăng nhập/đăng ký hiện
 * tại để các task sau (thêm đăng nhập Zalo, tài khoản giao lưu) không làm đổi
 * luồng cũ. Test mô tả code đang chạy, nên xanh ngay khi viết.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities } from "@/db/schema";
import { eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  setUserCookie: vi.fn(async () => {}),
  getUserFromCookie: vi.fn(async () => null),
  clearUserCookie: vi.fn(async () => {}),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
// Google verify nói chuyện mạng; mock để test điều khiển được claims.
const googleClaims = vi.hoisted(() => ({
  current: null as null | {
    sub: string;
    name?: string;
    email?: string;
    emailVerified: boolean;
    picture?: string;
  },
}));
vi.mock("@/lib/google-verify", () => ({
  verifyGoogleIdToken: vi.fn(async () => googleClaims.current),
}));

// Cờ giao lưu và Turnstile do test điều khiển (các case cũ không gọi tới).
const exchange = vi.hoisted(() => ({
  enabled: false,
  verifyTurnstile: vi.fn(async () => ({ ok: true }) as { ok: boolean }),
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => exchange.enabled),
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: exchange.verifyTurnstile,
}));
const googleVerify = await import("@/lib/google-verify");

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { googleLogin } = await import("./google-auth");
const { signupWithPassword } = await import("./password-auth");
const { findMemberByOAuth } = await import("@/lib/oauth-identity");

const TOKEN = "google-id-token-0000001"; // ≥16 ký tự (guard độ dài của googleLogin)
const SUB = "google-sub-0000000001";

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
  userMock.setUserCookie.mockClear();
  googleClaims.current = {
    sub: SUB,
    name: "Gia Lâm",
    email: "gialam@example.com",
    emailVerified: true,
  };
}

const allMembers = () => testDb.select().from(members);
const allIdentities = () => testDb.select().from(memberOauthIdentities);

describe("googleLogin (hành vi hiện tại)", () => {
  beforeEach(reset);

  it("googleLogin: sub mới → tạo member approvalStatus=pending, có identity google", async () => {
    const r = await googleLogin(TOKEN);
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });

    const rows = await allMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      approvalStatus: "pending",
      googleId: SUB,
      name: "Gia Lâm",
      email: "gialam@example.com",
    });
    const ids = await allIdentities();
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({
      memberId: rows[0].id,
      provider: "google",
      providerUid: SUB,
    });
    expect(userMock.setUserCookie).toHaveBeenCalledWith(rows[0].id, `g:${SUB}`);
  });

  it("googleLogin: sub đã có → dùng lại member, không tạo thêm", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Gia Lâm", googleId: SUB, approvalStatus: "approved" })
      .returning({ id: members.id });
    await testDb
      .insert(memberOauthIdentities)
      .values({ memberId: m.id, provider: "google", providerUid: SUB });

    const r = await googleLogin(TOKEN);
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });

    const rows = await allMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(m.id);
    expect(rows[0].approvalStatus).toBe("approved"); // không bị hạ về pending
    expect(await allIdentities()).toHaveLength(1);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(m.id, `g:${SUB}`);
  });
});

describe("googleLogin với intent giao lưu (g2a, Task 9)", () => {
  beforeEach(async () => {
    await reset();
    exchange.enabled = true;
    exchange.verifyTurnstile.mockReset();
    exchange.verifyTurnstile.mockResolvedValue({ ok: true });
    vi.mocked(googleVerify.verifyGoogleIdToken).mockClear();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.example.com");
  });
  afterEach(() => {
    exchange.enabled = false;
    vi.unstubAllEnvs();
  });

  const bucketCount = async () =>
    (await client.execute("SELECT COUNT(*) AS n FROM rate_limit_buckets"))
      .rows[0].n;

  it("cờ bật + Turnstile ok + sub mới → member signup_intent=exchange", async () => {
    const r = await googleLogin(TOKEN, {
      intent: "exchange",
      turnstileToken: "ts-token",
    });
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });
    expect(exchange.verifyTurnstile).toHaveBeenCalledWith("ts-token", {
      action: "exchange_login",
      remoteIp: undefined,
      expectedHostname: "fwbb.example.com",
    });
    const rows = await allMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      signupIntent: "exchange",
      approvalStatus: "pending",
    });
  });

  it("Turnstile hỏng → { error }, không tạo member, không verify Google, không ghi rate_limit_buckets", async () => {
    exchange.verifyTurnstile.mockResolvedValue({ ok: false });
    const r = await googleLogin(TOKEN, {
      intent: "exchange",
      turnstileToken: "bad",
    });
    expect(r).toEqual({ error: "securityCheckFailed" });
    expect(await allMembers()).toHaveLength(0);
    expect(googleVerify.verifyGoogleIdToken).not.toHaveBeenCalled();
    expect(await bucketCount()).toBe(0);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
  });

  it("thiếu NEXT_PUBLIC_APP_URL → { error } fail-closed, không gọi Turnstile", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const r = await googleLogin(TOKEN, {
      intent: "exchange",
      turnstileToken: "ts-token",
    });
    expect(r).toEqual({ error: "securityCheckFailed" });
    expect(exchange.verifyTurnstile).not.toHaveBeenCalled();
    expect(await allMembers()).toHaveLength(0);
    expect(await bucketCount()).toBe(0);
  });

  it("cờ tắt → bỏ qua intent, tạo member group như cũ, không đòi Turnstile", async () => {
    exchange.enabled = false;
    const r = await googleLogin(TOKEN, { intent: "exchange" });
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });
    expect(exchange.verifyTurnstile).not.toHaveBeenCalled();
    const rows = await allMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0].signupIntent).toBe("group");
  });

  it("sub đã có → không đổi signup_intent và approval_status", async () => {
    const [m] = await testDb
      .insert(members)
      .values({
        name: "Gia Lâm",
        googleId: SUB,
        approvalStatus: "approved",
        signupIntent: "group",
      })
      .returning({ id: members.id });
    await testDb
      .insert(memberOauthIdentities)
      .values({ memberId: m.id, provider: "google", providerUid: SUB });

    const r = await googleLogin(TOKEN, {
      intent: "exchange",
      turnstileToken: "ts-token",
    });
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });
    const rows = await allMembers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: m.id,
      signupIntent: "group",
      approvalStatus: "approved",
    });
  });
});

describe("findMemberByOAuth (fallback cột legacy)", () => {
  beforeEach(reset);

  it("findMemberByOAuth: facebook fallback cột legacy facebook_id vẫn khớp", async () => {
    // Chỉ có cột legacy, KHÔNG có identity row (row tạo trước backfill).
    const [m] = await testDb
      .insert(members)
      .values({ name: "FB cũ", facebookId: "fb-legacy-1" })
      .returning({ id: members.id });

    expect((await findMemberByOAuth("facebook", "fb-legacy-1"))?.id).toBe(m.id);
    expect(await findMemberByOAuth("facebook", "fb-other")).toBeNull();
    // Cột facebook_id không được khớp nhầm sang provider google.
    expect(await findMemberByOAuth("google", "fb-legacy-1")).toBeNull();
    expect(await allIdentities()).toHaveLength(0);
  });

  it("findMemberByOAuth: google fallback cột legacy google_id vẫn khớp", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Google cũ", googleId: "g-legacy-1" })
      .returning({ id: members.id });

    expect((await findMemberByOAuth("google", "g-legacy-1"))?.id).toBe(m.id);
    expect(await findMemberByOAuth("google", "g-other")).toBeNull();
    expect(await findMemberByOAuth("facebook", "g-legacy-1")).toBeNull();
    expect(await allIdentities()).toHaveLength(0);
  });
});

describe("signupWithPassword (hành vi hiện tại)", () => {
  beforeEach(reset);

  it("signupWithPassword → member pending, không có identity", async () => {
    const r = await signupWithPassword({
      name: "Mật Khẩu",
      email: "matkhau@example.com",
      password: "supersecret123",
    });
    expect(r).toEqual({ success: true, memberName: "Mật Khẩu" });

    const m = (
      await testDb
        .select()
        .from(members)
        .where(eq(members.email, "matkhau@example.com"))
    )[0];
    expect(m.approvalStatus).toBe("pending");
    expect(m.googleId).toBeNull();
    expect(m.facebookId).toBeNull();
    expect(await allIdentities()).toHaveLength(0);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(m.id, `pw:${m.id}`);
  });
});

// G2d Task 13: đăng nhập Google ở trang giao lưu ghi tín hiệu mạng đã băm.
const nextHeaders = await import("next/headers");
const { ipSignalHash } = await import("@/lib/reputation/ip-signals");

describe("googleLogin giao lưu ghi tín hiệu mạng (G2d)", () => {
  const IP = "203.0.113.9";
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await reset();
    await client.execute("DELETE FROM member_ip_signals");
    exchange.enabled = true;
    exchange.verifyTurnstile.mockReset();
    exchange.verifyTurnstile.mockResolvedValue({ ok: true });
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.example.com");
    vi.mocked(nextHeaders.headers).mockImplementation(
      async () =>
        new Headers({ "x-real-ip": IP }) as unknown as Awaited<
          ReturnType<typeof nextHeaders.headers>
        >,
    );
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    exchange.enabled = false;
    vi.unstubAllEnvs();
    vi.mocked(nextHeaders.headers).mockImplementation(
      async () =>
        ({ get: () => null }) as unknown as Awaited<
          ReturnType<typeof nextHeaders.headers>
        >,
    );
    consoleError.mockRestore();
    await client.execute("DROP TRIGGER IF EXISTS ip_signal_boom");
  });

  const signals = async () =>
    (
      await client.execute(
        "SELECT member_id, ip_hash, kind FROM member_ip_signals ORDER BY id",
      )
    ).rows.map((r) => [Number(r.member_id), String(r.ip_hash), String(r.kind)]);
  const exchangeOpts = { intent: "exchange" as const, turnstileToken: "ts" };

  it("a new exchange Google account records signup, a returning one records login, a group login records nothing", async () => {
    expect(await googleLogin(TOKEN, exchangeOpts)).toMatchObject({
      success: true,
    });
    expect(await googleLogin(TOKEN, exchangeOpts)).toMatchObject({
      success: true,
    });
    const [m] = await allMembers();
    expect(await signals()).toEqual([
      [m.id, ipSignalHash(IP), "signup"],
      [m.id, ipSignalHash(IP), "login"],
    ]);

    await client.execute("DELETE FROM member_ip_signals");
    expect(await googleLogin(TOKEN)).toMatchObject({ success: true });
    exchange.enabled = false;
    expect(await googleLogin(TOKEN, exchangeOpts)).toMatchObject({
      success: true,
    });
    expect(await signals()).toEqual([]);
  });

  it("a recording failure does not fail the Zalo callback or the Google exchange login; the log has only the member id", async () => {
    await client.execute(
      "CREATE TRIGGER ip_signal_boom BEFORE INSERT ON member_ip_signals BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const r = await googleLogin(TOKEN, exchangeOpts);
    expect(r).toEqual({ success: true, memberName: "Gia Lâm" });
    const [m] = await allMembers();
    expect(userMock.setUserCookie).toHaveBeenCalledWith(m.id, `g:${SUB}`);
    expect(consoleError).toHaveBeenCalledWith("[DupSignal] record_failed", {
      memberId: m.id,
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(IP);
    expect(logged).not.toContain("Gia Lâm");
    expect(logged).not.toContain("boom");
  });
});
