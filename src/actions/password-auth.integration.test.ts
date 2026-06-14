/**
 * Integration tests cho email/password auth: signup (→ pending), login (gate
 * rejected/khóa + bcrypt), setPassword (first-set + change). Auth actions trước
 * đây HOÀN TOÀN chưa có test — đây là phần lõi đăng ký/đăng nhập.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  setUserCookie: vi.fn(async () => {}),
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// headers() → không có IP thật trong test (rate-limit dùng "unknown").
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { signupWithPassword, loginWithPassword, setPassword } =
  await import("./password-auth");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM members");
  userMock.setUserCookie.mockClear();
  userMock.getUserFromCookie.mockReset();
}

async function memberByEmail(email: string) {
  return testDb.query.members.findFirst({ where: eq(members.email, email) });
}

describe("signupWithPassword", () => {
  beforeEach(reset);

  it("tạo member 'pending' + set cookie khi hợp lệ", async () => {
    const r = await signupWithPassword({
      name: "Alice",
      email: "Alice@Example.com",
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    const m = await memberByEmail("alice@example.com"); // normalized lowercase
    expect(m?.approvalStatus).toBe("pending");
    expect(m?.passwordHash).toBeTruthy();
    expect(m?.passwordHash).not.toBe("supersecret123"); // hashed
    expect(userMock.setUserCookie).toHaveBeenCalledWith(m!.id, `pw:${m!.id}`);
  });

  it("từ chối email sai định dạng", async () => {
    const r = await signupWithPassword({
      name: "X",
      email: "not-an-email",
      password: "supersecret123",
    });
    expect("error" in r).toBe(true);
  });

  it("từ chối mật khẩu < 8 ký tự", async () => {
    const r = await signupWithPassword({
      name: "X",
      email: "x@example.com",
      password: "short",
    });
    expect("error" in r).toBe(true);
  });

  it("từ chối email trùng", async () => {
    await signupWithPassword({
      name: "Alice",
      email: "dup@example.com",
      password: "supersecret123",
    });
    const r = await signupWithPassword({
      name: "Bob",
      email: "dup@example.com",
      password: "anothersecret123",
    });
    expect("error" in r).toBe(true);
  });
});

describe("loginWithPassword", () => {
  beforeEach(reset);

  async function seedPwMember(opts: {
    email: string;
    password: string;
    approvalStatus?: "pending" | "approved" | "rejected";
    isActive?: boolean;
  }) {
    // Đăng ký để có hash thật, rồi chỉnh trạng thái.
    await signupWithPassword({
      name: "Member",
      email: opts.email,
      password: opts.password,
    });
    const m = await memberByEmail(opts.email.toLowerCase());
    await testDb
      .update(members)
      .set({
        approvalStatus: opts.approvalStatus ?? "approved",
        isActive: opts.isActive ?? true,
      })
      .where(eq(members.id, m!.id));
    userMock.setUserCookie.mockClear();
    return m!.id;
  }

  it("đăng nhập đúng mật khẩu → success + cookie", async () => {
    const id = await seedPwMember({
      email: "a@example.com",
      password: "supersecret123",
    });
    const r = await loginWithPassword({
      email: "A@Example.com", // case-insensitive
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(id, `pw:${id}`);
  });

  it("sai mật khẩu → error chung (không leak)", async () => {
    await seedPwMember({ email: "a@example.com", password: "supersecret123" });
    const r = await loginWithPassword({
      email: "a@example.com",
      password: "wrongpassword",
    });
    expect("error" in r).toBe(true);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
  });

  it("email không tồn tại → error chung", async () => {
    const r = await loginWithPassword({
      email: "ghost@example.com",
      password: "whatever123",
    });
    expect("error" in r).toBe(true);
  });

  it("member bị khóa (isActive=false) → chặn", async () => {
    await seedPwMember({
      email: "locked@example.com",
      password: "supersecret123",
      isActive: false,
    });
    const r = await loginWithPassword({
      email: "locked@example.com",
      password: "supersecret123",
    });
    expect("error" in r).toBe(true);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
  });

  it("member bị reject → chặn", async () => {
    await seedPwMember({
      email: "rej@example.com",
      password: "supersecret123",
      approvalStatus: "rejected",
    });
    const r = await loginWithPassword({
      email: "rej@example.com",
      password: "supersecret123",
    });
    expect("error" in r).toBe(true);
  });
});

describe("setPassword", () => {
  beforeEach(reset);

  it("first-set (chưa có hash) cần email + set thành công", async () => {
    // Member OAuth chưa có password/email.
    const [m] = await testDb
      .insert(members)
      .values({ name: "OAuthUser", facebookId: "fb-x" })
      .returning({ id: members.id });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: m.id,
      externalId: "fb-x",
    });

    const r = await setPassword({
      newPassword: "brandnewpass123",
      email: "oauth@example.com",
    });
    expect("error" in r).toBe(false);
    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(after?.passwordHash).toBeTruthy();
    expect(after?.email).toBe("oauth@example.com");
  });

  it("đổi password yêu cầu currentPassword đúng", async () => {
    await signupWithPassword({
      name: "Alice",
      email: "chg@example.com",
      password: "originalpass123",
    });
    const m = await memberByEmail("chg@example.com");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: m!.id,
      externalId: `pw:${m!.id}`,
    });

    // Sai current → error.
    const bad = await setPassword({
      currentPassword: "wrongcurrent",
      newPassword: "newpass12345",
    });
    expect("error" in bad).toBe(true);

    // Đúng current → success.
    const ok = await setPassword({
      currentPassword: "originalpass123",
      newPassword: "newpass12345",
    });
    expect("error" in ok).toBe(false);
  });
});
