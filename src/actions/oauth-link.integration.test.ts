/**
 * Multi-SSO self-service: linkGoogleIdentity + unlinkOAuthIdentity.
 *
 * Trọng tâm bảo mật:
 * - Link: chặn gắn 1 Google đang thuộc member KHÁC (chống chiếm tài khoản).
 * - Unlink: chặn gỡ phương thức đăng nhập CUỐI khi chưa có mật khẩu; dọn cột
 *   legacy googleId/facebookId để fallback không cho login lại qua uid đã gỡ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "127.0.0.1"),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
  setUserCookie: vi.fn(),
  clearUserCookie: vi.fn(),
}));
import { getUserFromCookie } from "@/lib/user-identity";

// verifyGoogleIdToken (module-private) gọi fetch → mock: dùng chính id_token
// trong URL làm `sub` để test điều khiển được Google account nào.
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: unknown) => {
    const m = /id_token=([^&]+)/.exec(String(url));
    const sub = m ? decodeURIComponent(m[1]) : "unknown";
    return {
      ok: true,
      json: async () => ({
        aud: "test-client",
        iss: "accounts.google.com",
        sub,
        email: `${sub}@x.com`,
      }),
    } as Response;
  }),
);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { linkGoogleIdentity } = await import("./google-auth");
const { unlinkOAuthIdentity } = await import("./members");
const { ensureOAuthIdentity, findMemberByOAuth } =
  await import("@/lib/oauth-identity");

function asUser(memberId: number) {
  vi.mocked(getUserFromCookie).mockResolvedValue({
    memberId,
    externalId: "",
  });
}

async function reset() {
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "test-client";
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
}

describe("linkGoogleIdentity", () => {
  beforeEach(reset);

  // Google `sub` phải ≥16 ký tự (guard length trong linkGoogleIdentity) và
  // token truyền vào == sub (fetch mock echo id_token thành sub).
  const SUB_PRIMARY = "google-primary-00001";
  const SUB_SECOND = "google-second-000001";
  const SUB_VICTIM = "google-victim-000001";
  const SUB_MINE = "google-mine-0000001";

  it("liên kết Google chưa thuộc ai vào member hiện tại", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Me", googleId: SUB_PRIMARY })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: SUB_PRIMARY,
    });
    asUser(m.id);

    const r = await linkGoogleIdentity(SUB_SECOND);
    expect(r).toEqual({ success: true });
    expect((await findMemberByOAuth("google", SUB_SECOND))?.id).toBe(m.id);
  });

  it("CHẶN liên kết Google đang thuộc member khác (chống chiếm tài khoản)", async () => {
    const [victim] = await testDb
      .insert(members)
      .values({ name: "Victim", googleId: SUB_VICTIM })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: victim.id,
      provider: "google",
      uid: SUB_VICTIM,
    });
    const [attacker] = await testDb
      .insert(members)
      .values({ name: "Attacker", googleId: "g-att" })
      .returning({ id: members.id });
    asUser(attacker.id);

    const r = await linkGoogleIdentity(SUB_VICTIM);
    expect(r).toHaveProperty("error");
    // Victim's identity KHÔNG bị đổi chủ.
    expect((await findMemberByOAuth("google", SUB_VICTIM))?.id).toBe(victim.id);
  });

  it("liên kết lại chính Google đã có → success no-op (already)", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Me", googleId: SUB_MINE })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: SUB_MINE,
    });
    asUser(m.id);

    const r = await linkGoogleIdentity(SUB_MINE);
    expect(r).toMatchObject({ success: true, already: true });
  });

  it("chưa đăng nhập → error", async () => {
    vi.mocked(getUserFromCookie).mockResolvedValue(null);
    const r = await linkGoogleIdentity("google-x-00000001");
    expect(r).toHaveProperty("error");
  });

  it("self qua cột legacy (chưa có identity row) → tạo identity row để /me quản lý được", async () => {
    const LEGACY = "google-legacy-00001";
    const [m] = await testDb
      .insert(members)
      .values({ name: "LegacyOnly", googleId: LEGACY })
      .returning({ id: members.id });
    // KHÔNG ensureOAuthIdentity → chỉ có cột legacy, chưa có row (member cũ).
    asUser(m.id);

    const r = await linkGoogleIdentity(LEGACY);
    expect(r).toMatchObject({ success: true, already: true });
    // Giờ đã có identity row → hiện & gỡ được ở /me.
    const row = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, LEGACY),
    });
    expect(row?.memberId).toBe(m.id);
  });
});

describe("unlinkOAuthIdentity", () => {
  beforeEach(reset);

  it("gỡ 1 identity + dọn cột legacy trùng uid; login qua uid đó tắt hẳn", async () => {
    // Member có mật khẩu (nên gỡ hết identity vẫn không bị khoá) + 1 Google.
    const [m] = await testDb
      .insert(members)
      .values({ name: "Me", googleId: "g-1", passwordHash: "hash" })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: "g-1",
    });
    asUser(m.id);
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-1"),
    });

    const r = await unlinkOAuthIdentity(idn!.id);
    expect(r).toEqual({ success: true });
    // Identity xoá + fallback legacy cũng bị clear → không tìm ra member nữa.
    expect(await findMemberByOAuth("google", "g-1")).toBeNull();
    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(after?.googleId).toBeNull();
  });

  it("CHẶN gỡ phương thức đăng nhập cuối khi chưa có mật khẩu", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "OnlyGoogle", googleId: "g-only" })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: "g-only",
    });
    asUser(m.id);
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-only"),
    });

    const r = await unlinkOAuthIdentity(idn!.id);
    expect(r).toHaveProperty("error");
    // Vẫn còn login được.
    expect((await findMemberByOAuth("google", "g-only"))?.id).toBe(m.id);
  });

  it("cho gỡ khi còn identity khác (không mật khẩu)", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "TwoGoogle", googleId: "g-a" })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: "g-a",
    });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: "g-b",
    });
    asUser(m.id);
    const idnB = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-b"),
    });

    const r = await unlinkOAuthIdentity(idnB!.id);
    expect(r).toEqual({ success: true });
    expect(await findMemberByOAuth("google", "g-b")).toBeNull();
    // g-a (identity chính + legacy) vẫn login được.
    expect((await findMemberByOAuth("google", "g-a"))?.id).toBe(m.id);
  });

  it("CHẶN gỡ Google cuối khi chỉ có mật khẩu TẠM đã hết hạn", async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const [m] = await testDb
      .insert(members)
      .values({
        name: "ExpiredTemp",
        googleId: "g-exp",
        passwordHash: "temp-hash",
        passwordResetExpiresAt: expired,
      })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: m.id,
      provider: "google",
      uid: "g-exp",
    });
    asUser(m.id);
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-exp"),
    });

    const r = await unlinkOAuthIdentity(idn!.id);
    // Mật khẩu tạm hết hạn KHÔNG tính là phương thức dùng được → chặn.
    expect(r).toHaveProperty("error");
    expect((await findMemberByOAuth("google", "g-exp"))?.id).toBe(m.id);
  });

  it("CHẶN gỡ identity của member khác", async () => {
    const [other] = await testDb
      .insert(members)
      .values({ name: "Other", googleId: "g-other" })
      .returning({ id: members.id });
    await ensureOAuthIdentity({
      memberId: other.id,
      provider: "google",
      uid: "g-other",
    });
    const [me] = await testDb
      .insert(members)
      .values({ name: "Me", googleId: "g-me", passwordHash: "h" })
      .returning({ id: members.id });
    asUser(me.id);
    const otherIdn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-other"),
    });

    const r = await unlinkOAuthIdentity(otherIdn!.id);
    expect(r).toHaveProperty("error");
    expect((await findMemberByOAuth("google", "g-other"))?.id).toBe(other.id);
  });
});
