/**
 * Integration tests cho admin Google SSO (Phase 4): adminGoogleLogin (tra admin
 * theo google_id, KHÔNG match email), linkAdminGoogle (chống trùng admin khác),
 * unlinkAdminGoogle, getCurrentAdmin trả googleId. Mock google-verify + @/lib/auth;
 * DB thật qua createTestDb (KHÔNG đụng prod).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "test-ip"),
}));
const verifyMock = vi.hoisted(() => ({ verifyGoogleIdToken: vi.fn() }));
vi.mock("@/lib/google-verify", () => verifyMock);
const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setAdminCookie: vi.fn(async () => {}),
  clearAdminCookie: vi.fn(async () => {}),
  getAdminFromCookie: vi.fn(),
}));
vi.mock("@/lib/auth", () => authMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  adminGoogleLogin,
  linkAdminGoogle,
  unlinkAdminGoogle,
  getCurrentAdmin,
} = await import("./auth");

const TOKEN = "x".repeat(40); // đủ dài để qua length check

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM admins");
  verifyMock.verifyGoogleIdToken.mockReset();
  authMock.requireAdmin.mockReset();
  authMock.setAdminCookie.mockClear();
}
async function seedAdmin(opts: { username: string; googleId?: string | null }) {
  const [a] = await testDb
    .insert(admins)
    .values({
      username: opts.username,
      passwordHash: "hash",
      googleId: opts.googleId ?? null,
    })
    .returning({ id: admins.id });
  return a.id;
}
function asAdmin(id: number) {
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: String(id), role: "admin" },
  });
}

describe("adminGoogleLogin", () => {
  beforeEach(reset);

  it("google_id khớp → setAdminCookie(admin.id) + success", async () => {
    const id = await seedAdmin({ username: "root", googleId: "g-sub-1" });
    verifyMock.verifyGoogleIdToken.mockResolvedValue({
      sub: "g-sub-1",
      emailVerified: true,
    });
    const r = await adminGoogleLogin(TOKEN);
    expect(r).toMatchObject({ success: true });
    expect(authMock.setAdminCookie).toHaveBeenCalledWith(id);
  });

  it("google_id KHÔNG khớp admin nào → error, không set cookie", async () => {
    await seedAdmin({ username: "root", googleId: "g-sub-1" });
    verifyMock.verifyGoogleIdToken.mockResolvedValue({
      sub: "g-other",
      emailVerified: true,
    });
    const r = await adminGoogleLogin(TOKEN);
    expect(r).toHaveProperty("error");
    expect(authMock.setAdminCookie).not.toHaveBeenCalled();
  });

  it("verify thất bại (null) → error, không set cookie", async () => {
    verifyMock.verifyGoogleIdToken.mockResolvedValue(null);
    const r = await adminGoogleLogin(TOKEN);
    expect(r).toHaveProperty("error");
    expect(authMock.setAdminCookie).not.toHaveBeenCalled();
  });

  it("token quá ngắn → error, KHÔNG gọi verify", async () => {
    const r = await adminGoogleLogin("short");
    expect(r).toHaveProperty("error");
    expect(verifyMock.verifyGoogleIdToken).not.toHaveBeenCalled();
  });
});

describe("linkAdminGoogle", () => {
  beforeEach(reset);

  it("liên kết google_id vào admin hiện tại", async () => {
    const id = await seedAdmin({ username: "root" });
    asAdmin(id);
    verifyMock.verifyGoogleIdToken.mockResolvedValue({
      sub: "g-new",
      emailVerified: true,
    });
    const r = await linkAdminGoogle(TOKEN);
    expect(r).toMatchObject({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.googleId).toBe("g-new");
  });

  it("google_id đã thuộc admin KHÁC → error, không set", async () => {
    await seedAdmin({ username: "other", googleId: "g-x" });
    const id = await seedAdmin({ username: "me" });
    asAdmin(id);
    verifyMock.verifyGoogleIdToken.mockResolvedValue({
      sub: "g-x",
      emailVerified: true,
    });
    const r = await linkAdminGoogle(TOKEN);
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.googleId).toBeNull();
  });

  it("verify thất bại → error", async () => {
    const id = await seedAdmin({ username: "root" });
    asAdmin(id);
    verifyMock.verifyGoogleIdToken.mockResolvedValue(null);
    const r = await linkAdminGoogle(TOKEN);
    expect(r).toHaveProperty("error");
  });
});

describe("unlinkAdminGoogle", () => {
  beforeEach(reset);

  it("gỡ google_id về null", async () => {
    const id = await seedAdmin({ username: "root", googleId: "g-1" });
    asAdmin(id);
    const r = await unlinkAdminGoogle();
    expect(r).toMatchObject({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.googleId).toBeNull();
  });
});

describe("getCurrentAdmin (googleId)", () => {
  beforeEach(reset);

  it("trả googleId của admin hiện tại", async () => {
    await seedAdmin({ username: "root", googleId: "g-1" });
    const id = (await testDb.query.admins.findFirst({
      where: eq(admins.username, "root"),
    }))!.id;
    asAdmin(id);
    const me = await getCurrentAdmin();
    expect(me?.googleId).toBe("g-1");
  });
});
