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
    username?: string;
    phoneNumber?: string;
    passwordResetExpiresAt?: string | null;
    mustChangePassword?: boolean;
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
        username: opts.username ?? null,
        phoneNumber: opts.phoneNumber ?? null,
        passwordResetExpiresAt: opts.passwordResetExpiresAt ?? null,
        mustChangePassword: opts.mustChangePassword ?? false,
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
      identifier: "A@Example.com", // case-insensitive
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(id, `pw:${id}`);
  });

  it("sai mật khẩu → error chung (không leak)", async () => {
    await seedPwMember({ email: "a@example.com", password: "supersecret123" });
    const r = await loginWithPassword({
      identifier: "a@example.com",
      password: "wrongpassword",
    });
    expect("error" in r).toBe(true);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
  });

  it("email không tồn tại → error chung", async () => {
    const r = await loginWithPassword({
      identifier: "ghost@example.com",
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
      identifier: "locked@example.com",
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
      identifier: "rej@example.com",
      password: "supersecret123",
    });
    expect("error" in r).toBe(true);
  });

  it("member khóa + SAI mật khẩu → lỗi CHUNG (không enumerate được)", async () => {
    // C4: check khóa/rejected phải chạy SAU bcrypt. Sai mật khẩu trên tài khoản
    // khóa phải trả cùng thông báo với định danh không tồn tại → không phân biệt.
    await seedPwMember({
      email: "lockedwrong@example.com",
      password: "supersecret123",
      isActive: false,
    });
    const locked = await loginWithPassword({
      identifier: "lockedwrong@example.com",
      password: "wrongpassword",
    });
    const ghost = await loginWithPassword({
      identifier: "ghost@example.com",
      password: "wrongpassword",
    });
    expect("error" in locked).toBe(true);
    expect("error" in ghost).toBe(true);
    expect((locked as { error: string }).error).toBe(
      (ghost as { error: string }).error,
    );
  });

  it("member khóa + ĐÚNG mật khẩu → mới lộ thông báo 'đã khóa'", async () => {
    await seedPwMember({
      email: "lockedok@example.com",
      password: "supersecret123",
      isActive: false,
    });
    const right = await loginWithPassword({
      identifier: "lockedok@example.com",
      password: "supersecret123",
    });
    const wrong = await loginWithPassword({
      identifier: "lockedok@example.com",
      password: "nope",
    });
    expect("error" in right).toBe(true);
    // Chỉ chủ tài khoản (đúng mật khẩu) thấy thông báo khóa; sai mật khẩu vẫn
    // là lỗi chung → 2 thông báo phải KHÁC nhau.
    expect((right as { error: string }).error).not.toBe(
      (wrong as { error: string }).error,
    );
  });

  it("đăng nhập bằng USERNAME (đa kênh)", async () => {
    const id = await seedPwMember({
      email: "u@example.com",
      password: "supersecret123",
      username: "cuncon",
    });
    const r = await loginWithPassword({
      identifier: "CunCon", // case-insensitive
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(id, `pw:${id}`);
  });

  it("đăng nhập bằng SỐ ĐIỆN THOẠI (khớp đúng 1)", async () => {
    const id = await seedPwMember({
      email: "p@example.com",
      password: "supersecret123",
      phoneNumber: "0912345678",
    });
    const r = await loginWithPassword({
      identifier: "0912 345 678", // có khoảng trắng
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(id, `pw:${id}`);
  });

  it("SĐT trùng 2 member → login-by-phone mơ hồ → từ chối", async () => {
    await seedPwMember({
      email: "p1@example.com",
      password: "supersecret123",
      phoneNumber: "0900000000",
    });
    await seedPwMember({
      email: "p2@example.com",
      password: "supersecret123",
      phoneNumber: "0900000000",
    });
    const r = await loginWithPassword({
      identifier: "0900000000",
      password: "supersecret123",
    });
    expect("error" in r).toBe(true);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
  });

  it("mật khẩu tạm CÒN hạn → cho vào (gate sẽ bắt đổi)", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const id = await seedPwMember({
      email: "temp@example.com",
      password: "temppass123",
      passwordResetExpiresAt: future,
      mustChangePassword: true,
    });
    const r = await loginWithPassword({
      identifier: "temp@example.com",
      password: "temppass123",
    });
    expect("error" in r).toBe(false);
    expect(userMock.setUserCookie).toHaveBeenCalledWith(id, `pw:${id}`);
  });

  it("mật khẩu tạm HẾT hạn → từ chối", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    await seedPwMember({
      email: "expired@example.com",
      password: "temppass123",
      passwordResetExpiresAt: past,
      mustChangePassword: true,
    });
    const r = await loginWithPassword({
      identifier: "expired@example.com",
      password: "temppass123",
    });
    expect("error" in r).toBe(true);
    expect(userMock.setUserCookie).not.toHaveBeenCalled();
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

  it("force-change (mustChangePassword): đổi KHÔNG cần current + clear cờ", async () => {
    await signupWithPassword({
      name: "Forced",
      email: "forced@example.com",
      password: "temppass123",
    });
    const m = await memberByEmail("forced@example.com");
    await testDb
      .update(members)
      .set({
        mustChangePassword: true,
        passwordResetExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .where(eq(members.id, m!.id));
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: m!.id,
      externalId: `pw:${m!.id}`,
    });

    // Không truyền currentPassword — vẫn đổi được vì đang force-change.
    const r = await setPassword({ newPassword: "freshpass12345" });
    expect("error" in r).toBe(false);

    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m!.id),
    });
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.passwordResetExpiresAt).toBeNull();
  });
});
