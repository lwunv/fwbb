/**
 * Integration tests cho password-reset actions dùng chung member + admin:
 * requestPasswordReset (LUÔN neutral — chống email enumeration),
 * resetPasswordWithToken (single-use qua CAS), validateResetToken (đọc thuần).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, admins, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashResetToken } from "@/lib/password-reset-token";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "test-ip"),
}));
// after() thực thi ngay trong test — mail phải "xong" trước khi assert.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

// checkRateLimit thật đi qua db.transaction() (Drizzle) — dưới libsql local
// file client, xen kẽ 1 db.transaction() với 1 UPDATE trần (CAS của
// resetPasswordWithToken) trên 2 "connection" khác nhau (client tự mở
// connection mới sau mỗi transaction) gây SQLITE_BUSY chéo connection, không
// liên quan gì tới tính đúng của CAS đang test. Rate-limit DB-backed đã có
// bài test riêng (src/lib/rate-limit.test.ts) — ở đây fake bằng in-memory
// map, giữ ĐÚNG semantics count+window+limit để test rate-limit-exceeded vẫn
// còn ý nghĩa, nhưng không đụng DB nữa → hết race giả với CAS.
const rateLimitMock = vi.hoisted(() => {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    checkRateLimit: vi.fn(
      async (key: string, limit: number, windowMs: number) => {
        const now = Date.now();
        const existing = buckets.get(key);
        if (!existing || existing.resetAt <= now) {
          buckets.set(key, { count: 1, resetAt: now + windowMs });
          return { ok: true, remaining: limit - 1 };
        }
        if (existing.count >= limit) {
          return {
            ok: false,
            retryAfter: Math.ceil((existing.resetAt - now) / 1000),
            remaining: 0,
          };
        }
        existing.count += 1;
        return { ok: true, remaining: limit - existing.count };
      },
    ),
    _reset: () => buckets.clear(),
  };
});
vi.mock("@/lib/rate-limit", () => rateLimitMock);

const mailerMock = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/mailer", () => mailerMock);

const userIdentityMock = vi.hoisted(() => ({
  clearUserCookie: vi.fn(async () => {}),
}));
vi.mock("@/lib/user-identity", () => userIdentityMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { requestPasswordReset, resetPasswordWithToken, validateResetToken } =
  await import("./password-reset");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM password_reset_tokens");
  await client.execute("DELETE FROM members");
  await client.execute("DELETE FROM admins");
  mailerMock.sendPasswordResetEmail.mockClear();
  userIdentityMock.clearUserCookie.mockClear();
  rateLimitMock._reset();
}

async function seedMember(opts: {
  email?: string | null;
  passwordHash?: string | null;
  isActive?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "Test Member",
      email: opts.email ?? null,
      passwordHash: opts.passwordHash ?? null,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning();
  return m;
}

let adminSeq = 0;
async function seedAdmin(opts: { email?: string | null }) {
  adminSeq += 1;
  const [a] = await testDb
    .insert(admins)
    .values({
      username: `admin${adminSeq}`,
      passwordHash: "hash",
      email: opts.email ?? null,
    })
    .returning();
  return a;
}

async function allTokenRows() {
  return testDb.query.passwordResetTokens.findMany();
}

async function insertKnownToken(
  subject: { memberId?: number; adminId?: number },
  opts?: { expiresAt?: string; usedAt?: string | null },
) {
  const rawToken = `raw-${Math.random().toString(36).slice(2)}`;
  const tokenHash = hashResetToken(rawToken);
  await testDb.insert(passwordResetTokens).values({
    memberId: subject.memberId ?? null,
    adminId: subject.adminId ?? null,
    tokenHash,
    expiresAt: opts?.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
    usedAt: opts?.usedAt ?? null,
  });
  return rawToken;
}

describe("requestPasswordReset", () => {
  beforeEach(reset);

  it("member tồn tại + có email → tạo token + gọi mailer + trả neutral", async () => {
    const m = await seedMember({ email: "alice@example.com" });
    const r = await requestPasswordReset({
      email: "Alice@Example.com",
      scope: "member",
    });
    expect(r.ok).toBe(true);
    expect(typeof r.message).toBe("string");

    const rows = await allTokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(m.id);
    expect(rows[0].adminId).toBeNull();
    expect(rows[0].usedAt).toBeNull();

    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledWith(
      "alice@example.com",
      expect.stringContaining("/reset-password/"),
    );
  });

  it("member OAuth-only (passwordHash null) có email → vẫn gửi (đặt mật khẩu lần đầu)", async () => {
    await seedMember({ email: "oauth@example.com", passwordHash: null });
    await requestPasswordReset({ email: "oauth@example.com", scope: "member" });
    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(await allTokenRows()).toHaveLength(1);
  });

  it("member không tồn tại → vẫn neutral, không tạo token, không gửi mail", async () => {
    const r = await requestPasswordReset({
      email: "ghost@example.com",
      scope: "member",
    });
    expect(r.ok).toBe(true);
    expect(await allTokenRows()).toHaveLength(0);
    expect(mailerMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("member bị khóa (isActive=false) → neutral, không gửi", async () => {
    await seedMember({ email: "locked@example.com", isActive: false });
    await requestPasswordReset({
      email: "locked@example.com",
      scope: "member",
    });
    expect(mailerMock.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await allTokenRows()).toHaveLength(0);
  });

  it("member bị rejected → neutral, không gửi", async () => {
    await seedMember({
      email: "rej@example.com",
      approvalStatus: "rejected",
    });
    await requestPasswordReset({ email: "rej@example.com", scope: "member" });
    expect(mailerMock.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(await allTokenRows()).toHaveLength(0);
  });

  it("member không có email (null) → không match được, neutral", async () => {
    await seedMember({ email: null });
    const r = await requestPasswordReset({
      email: "noemail@example.com",
      scope: "member",
    });
    expect(r.ok).toBe(true);
    expect(await allTokenRows()).toHaveLength(0);
  });

  it("scope admin: tra bảng admins, không phải members", async () => {
    const a = await seedAdmin({ email: "admin@example.com" });
    // Member trùng email KHÔNG được tồn tại — đảm bảo action thực sự query
    // đúng bảng theo scope chứ không lẫn.
    const r = await requestPasswordReset({
      email: "admin@example.com",
      scope: "admin",
    });
    expect(r.ok).toBe(true);
    const rows = await allTokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].adminId).toBe(a.id);
    expect(rows[0].memberId).toBeNull();
    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledWith(
      "admin@example.com",
      expect.stringContaining("/reset-password/"),
    );
  });

  it("scope admin: admin không tồn tại → neutral, không tạo token", async () => {
    const r = await requestPasswordReset({
      email: "noadmin@example.com",
      scope: "admin",
    });
    expect(r.ok).toBe(true);
    expect(await allTokenRows()).toHaveLength(0);
  });

  it("gọi lại lần 2 (dưới rate-limit) → xoá token cũ, chỉ còn 1 token active", async () => {
    await seedMember({ email: "twice@example.com" });
    await requestPasswordReset({ email: "twice@example.com", scope: "member" });
    const first = await allTokenRows();
    await requestPasswordReset({ email: "twice@example.com", scope: "member" });
    const second = await allTokenRows();

    expect(second).toHaveLength(1);
    expect(second[0].tokenHash).not.toBe(first[0].tokenHash);
    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledTimes(2);
  });

  it("vượt rate-limit theo email (3/15') → vẫn neutral, không tạo/gửi thêm", async () => {
    await seedMember({ email: "ratelimited@example.com" });
    for (let i = 0; i < 3; i++) {
      const r = await requestPasswordReset({
        email: "ratelimited@example.com",
        scope: "member",
      });
      expect(r.ok).toBe(true);
    }
    const afterThree = await allTokenRows();
    expect(afterThree).toHaveLength(1);
    const hashAfterThree = afterThree[0].tokenHash;

    const blocked = await requestPasswordReset({
      email: "ratelimited@example.com",
      scope: "member",
    });
    expect(blocked.ok).toBe(true); // vẫn neutral — không lộ rate-limit

    const afterFour = await allTokenRows();
    expect(afterFour).toHaveLength(1);
    expect(afterFour[0].tokenHash).toBe(hashAfterThree); // không tạo token mới
    expect(mailerMock.sendPasswordResetEmail).toHaveBeenCalledTimes(3); // không gửi thêm
  });
});

describe("resetPasswordWithToken", () => {
  beforeEach(reset);

  it("token hợp lệ (member) → đổi passwordHash + usedAt set + clearUserCookie", async () => {
    const m = await seedMember({ email: "reset@example.com" });
    const raw = await insertKnownToken({ memberId: m.id });

    const r = await resetPasswordWithToken({
      token: raw,
      newPassword: "brandNewPass123",
    });
    expect(r).toEqual({ success: true, subject: "member" });

    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(after?.passwordHash).toBeTruthy();
    expect(after?.passwordHash).not.toBe(m.passwordHash);

    const tokenRow = await testDb.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, hashResetToken(raw)),
    });
    expect(tokenRow?.usedAt).toBeTruthy();

    expect(userIdentityMock.clearUserCookie).toHaveBeenCalledTimes(1);
  });

  it("token hợp lệ (admin) → đổi passwordHash bảng admins, KHÔNG clearUserCookie", async () => {
    const a = await seedAdmin({ email: "adminreset@example.com" });
    const raw = await insertKnownToken({ adminId: a.id });

    const r = await resetPasswordWithToken({
      token: raw,
      newPassword: "adminNewPass123",
    });
    expect(r).toEqual({ success: true, subject: "admin" });

    const after = await testDb.query.admins.findFirst({
      where: eq(admins.id, a.id),
    });
    expect(after?.passwordHash).not.toBe("hash");
    expect(userIdentityMock.clearUserCookie).not.toHaveBeenCalled();
  });

  it("token hết hạn → tokenError", async () => {
    const m = await seedMember({ email: "expired@example.com" });
    const raw = await insertKnownToken(
      { memberId: m.id },
      { expiresAt: new Date(Date.now() - 1000).toISOString() },
    );
    const r = await resetPasswordWithToken({
      token: raw,
      newPassword: "somePass123",
    });
    expect(r).toHaveProperty("tokenError");
  });

  it("token đã dùng → tokenError", async () => {
    const m = await seedMember({ email: "used@example.com" });
    const raw = await insertKnownToken(
      { memberId: m.id },
      { usedAt: new Date().toISOString() },
    );
    const r = await resetPasswordWithToken({
      token: raw,
      newPassword: "somePass123",
    });
    expect(r).toHaveProperty("tokenError");
  });

  it("token giả/không tồn tại → tokenError", async () => {
    const r = await resetPasswordWithToken({
      token: "totally-bogus-token",
      newPassword: "somePass123",
    });
    expect(r).toHaveProperty("tokenError");
  });

  it("mật khẩu ngắn → passwordError, token KHÔNG bị tiêu (còn dùng lại được)", async () => {
    const m = await seedMember({ email: "shortpw@example.com" });
    const raw = await insertKnownToken({ memberId: m.id });

    const bad = await resetPasswordWithToken({
      token: raw,
      newPassword: "short",
    });
    expect(bad).toHaveProperty("passwordError");

    const tokenRow = await testDb.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, hashResetToken(raw)),
    });
    expect(tokenRow?.usedAt).toBeNull(); // chưa bị tiêu

    const ok = await resetPasswordWithToken({
      token: raw,
      newPassword: "longEnoughPass123",
    });
    expect(ok).toEqual({ success: true, subject: "member" });
  });

  it("double-submit đồng thời cùng 1 token → CAS: đúng 1 thành công", async () => {
    const m = await seedMember({ email: "race@example.com" });
    const raw = await insertKnownToken({ memberId: m.id });

    const [r1, r2] = await Promise.all([
      resetPasswordWithToken({ token: raw, newPassword: "racePassA123" }),
      resetPasswordWithToken({ token: raw, newPassword: "racePassB123" }),
    ]);

    const successes = [r1, r2].filter((r) => "success" in r);
    const tokenErrors = [r1, r2].filter((r) => "tokenError" in r);
    expect(successes).toHaveLength(1);
    expect(tokenErrors).toHaveLength(1);
  });
});

describe("validateResetToken", () => {
  beforeEach(reset);

  it("token hợp lệ (member) → valid + subject member", async () => {
    const m = await seedMember({ email: "valid@example.com" });
    const raw = await insertKnownToken({ memberId: m.id });
    const r = await validateResetToken({ token: raw });
    expect(r).toEqual({ status: "valid", subject: "member" });
  });

  it("token hợp lệ (admin) → valid + subject admin", async () => {
    const a = await seedAdmin({ email: "validadmin@example.com" });
    const raw = await insertKnownToken({ adminId: a.id });
    const r = await validateResetToken({ token: raw });
    expect(r).toEqual({ status: "valid", subject: "admin" });
  });

  it("token hết hạn → invalid (không lộ subject)", async () => {
    const m = await seedMember({ email: "expvalidate@example.com" });
    const raw = await insertKnownToken(
      { memberId: m.id },
      { expiresAt: new Date(Date.now() - 1000).toISOString() },
    );
    const r = await validateResetToken({ token: raw });
    expect(r).toEqual({ status: "invalid" });
  });

  it("token đã dùng → invalid", async () => {
    const m = await seedMember({ email: "usedvalidate@example.com" });
    const raw = await insertKnownToken(
      { memberId: m.id },
      { usedAt: new Date().toISOString() },
    );
    const r = await validateResetToken({ token: raw });
    expect(r).toEqual({ status: "invalid" });
  });

  it("token không tồn tại → invalid", async () => {
    const r = await validateResetToken({ token: "never-existed" });
    expect(r).toEqual({ status: "invalid" });
  });

  it("không mutate usedAt (đọc thuần)", async () => {
    const m = await seedMember({ email: "readonly@example.com" });
    const raw = await insertKnownToken({ memberId: m.id });
    await validateResetToken({ token: raw });
    const row = await testDb.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, hashResetToken(raw)),
    });
    expect(row?.usedAt).toBeNull();
  });
});
