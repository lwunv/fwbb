import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "test-ip"),
}));
const authMock = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  setAdminCookie: vi.fn(async () => {}),
  clearAdminCookie: vi.fn(async () => {}),
  getAdminFromCookie: vi.fn(),
}));
vi.mock("@/lib/auth", () => authMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { updateAdminProfile, getCurrentAdmin } = await import("./auth");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM admins");
}
async function seedAdmin(username: string) {
  const [a] = await testDb
    .insert(admins)
    .values({ username, passwordHash: "hash" })
    .returning({ id: admins.id });
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  });
  return a.id;
}
function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("updateAdminProfile", () => {
  beforeEach(reset);

  it("set email + phone + username", async () => {
    const id = await seedAdmin("root");
    const r = await updateAdminProfile(
      null,
      fd({ username: "Root2", email: "A@Ex.com", phoneNumber: "0912 345 678" }),
    );
    expect(r).toEqual({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.username).toBe("root2");
    expect(a?.email).toBe("a@ex.com");
    expect(a?.phoneNumber).toBe("0912345678");
  });

  it("email sai định dạng → error, không lưu", async () => {
    const id = await seedAdmin("root");
    const r = await updateAdminProfile(null, fd({ email: "not-an-email" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("email trùng admin khác → error", async () => {
    await seedAdmin("other");
    await updateAdminProfile(null, fd({ email: "dup@ex.com" })); // other lấy email
    const id = await seedAdmin("me"); // switch cookie sang admin 'me'
    const r = await updateAdminProfile(null, fd({ email: "dup@ex.com" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("username trùng admin khác → error", async () => {
    await seedAdmin("taken");
    const id = await seedAdmin("me2");
    const r = await updateAdminProfile(null, fd({ username: "taken" }));
    expect(r).toHaveProperty("error");
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.username).toBe("me2");
  });

  it("username rỗng → error (NOT NULL, không cho xoá)", async () => {
    await seedAdmin("keep");
    const r = await updateAdminProfile(null, fd({ username: "" }));
    expect(r).toHaveProperty("error");
  });

  it("email rỗng → xoá (null)", async () => {
    const id = await seedAdmin("root");
    await updateAdminProfile(null, fd({ email: "x@ex.com" }));
    const r = await updateAdminProfile(null, fd({ email: "" }));
    expect(r).toEqual({ success: true });
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBeNull();
  });

  it("form không gửi field → giữ nguyên", async () => {
    const id = await seedAdmin("root");
    await updateAdminProfile(
      null,
      fd({ email: "keep@ex.com", phoneNumber: "0911" }),
    );
    await updateAdminProfile(null, fd({ username: "root" })); // chỉ gửi username
    const a = await testDb.query.admins.findFirst({ where: eq(admins.id, id) });
    expect(a?.email).toBe("keep@ex.com");
    expect(a?.phoneNumber).toBe("0911");
  });

  it("getCurrentAdmin trả hồ sơ hiện tại (không passwordHash)", async () => {
    await seedAdmin("root");
    const me = await getCurrentAdmin();
    expect(me?.username).toBe("root");
    expect(me).not.toHaveProperty("passwordHash");
  });
});
