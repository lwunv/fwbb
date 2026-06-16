import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateResetToken, hashResetToken } from "@/lib/password-reset-token";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));
// after(): run the scheduled callback immediately so the mailer is invoked in-test.
vi.mock("next/server", () => ({ after: (cb: () => unknown) => cb() }));

const mailMock = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn<
    (to: string, url: string) => Promise<{ success: boolean }>
  >(async () => ({ success: true })),
}));
vi.mock("@/lib/mailer", () => mailMock);

const userMock = vi.hoisted(() => ({
  setUserCookie: vi.fn(async () => {}),
  clearUserCookie: vi.fn(async () => {}),
  getUserFromCookie: vi.fn(async () => null),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { requestPasswordReset, validateResetToken, resetPasswordWithToken } =
  await import("./password-auth");

async function reset() {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM password_reset_tokens");
  await client.execute("DELETE FROM members");
  vi.clearAllMocks();
  mailMock.sendPasswordResetEmail.mockResolvedValue({ success: true });
}

async function seedMember(over: Partial<typeof members.$inferInsert> = {}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "M",
      email: "m@x.com",
      passwordHash: "x",
      approvalStatus: "approved",
      ...over,
    })
    .returning();
  return m;
}

function tokensFor(memberId: number) {
  return testDb.query.passwordResetTokens.findMany({
    where: eq(passwordResetTokens.memberId, memberId),
  });
}

function lastResetUrl(): string {
  return mailMock.sendPasswordResetEmail.mock.calls.at(-1)![1];
}

describe("requestPasswordReset", () => {
  beforeEach(reset);

  it("creates a token + sends mail for an active member, returns neutral success", async () => {
    const m = await seedMember();
    const r = await requestPasswordReset({ email: "m@x.com" });
    expect("error" in r).toBe(false);
    const toks = await tokensFor(m.id);
    expect(toks).toHaveLength(1);
    expect(toks[0].usedAt).toBeNull();
    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const rawTok = lastResetUrl().split("/reset-password/")[1];
    expect(hashResetToken(rawTok)).toBe(toks[0].tokenHash);
  });

  it("returns the SAME neutral shape for a non-existent email and does NOT send", async () => {
    const r = await requestPasswordReset({ email: "nobody@x.com" });
    expect("error" in r).toBe(false);
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("does not send for rejected or inactive members", async () => {
    await seedMember({ email: "r@x.com", approvalStatus: "rejected" });
    await seedMember({ email: "i@x.com", isActive: false });
    await requestPasswordReset({ email: "r@x.com" });
    await requestPasswordReset({ email: "i@x.com" });
    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("allows OAuth-only members (no passwordHash) that have an email", async () => {
    const m = await seedMember({ email: "o@x.com", passwordHash: null });
    await requestPasswordReset({ email: "o@x.com" });
    expect(await tokensFor(m.id)).toHaveLength(1);
    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it("invalidates previous unused tokens (only one live token remains)", async () => {
    const m = await seedMember();
    await requestPasswordReset({ email: "m@x.com" });
    await requestPasswordReset({ email: "m@x.com" });
    const live = (await tokensFor(m.id)).filter((t) => t.usedAt === null);
    expect(live).toHaveLength(1);
  });

  it("normalizes email for the per-email rate-limit (Foo@X == foo@x)", async () => {
    await seedMember({ email: "case@x.com" });
    await requestPasswordReset({ email: "case@x.com" });
    await requestPasswordReset({ email: "CASE@x.com" });
    await requestPasswordReset({ email: "Case@X.com" });
    const r4 = await requestPasswordReset({ email: "cAsE@x.com" });
    expect("error" in r4).toBe(true); // tooManyResetRequests
  });
});

describe("validateResetToken", () => {
  beforeEach(reset);

  it("returns valid for a fresh token", async () => {
    await seedMember();
    await requestPasswordReset({ email: "m@x.com" });
    const rawTok = lastResetUrl().split("/reset-password/")[1];
    const r = await validateResetToken({ token: rawTok });
    expect(r.status).toBe("valid");
  });

  it("returns invalid for a garbage token", async () => {
    const r = await validateResetToken({ token: "not-a-real-token" });
    expect(r.status).toBe("invalid");
  });

  it("returns invalid for an expired token", async () => {
    const m = await seedMember();
    const { rawToken, tokenHash } = generateResetToken();
    await testDb.insert(passwordResetTokens).values({
      memberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const r = await validateResetToken({ token: rawToken });
    expect(r.status).toBe("invalid");
  });

  it("returns invalid for an already-used token", async () => {
    const m = await seedMember();
    const { rawToken, tokenHash } = generateResetToken();
    await testDb.insert(passwordResetTokens).values({
      memberId: m.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: new Date().toISOString(),
    });
    const r = await validateResetToken({ token: rawToken });
    expect(r.status).toBe("invalid");
  });
});

describe("resetPasswordWithToken", () => {
  beforeEach(reset);

  async function freshToken(memberEmail = "m@x.com") {
    await requestPasswordReset({ email: memberEmail });
    return lastResetUrl().split("/reset-password/")[1];
  }

  it("sets a new password, marks token used, clears the cookie", async () => {
    const m = await seedMember({ passwordHash: "old" });
    const tok = await freshToken();
    const r = await resetPasswordWithToken({
      token: tok,
      newPassword: "brandnewpass1",
    });
    expect(r).toEqual({ success: true });
    const updated = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(updated!.passwordHash).not.toBe("old");
    expect(updated!.passwordHash).toBeTruthy();
    const row = await testDb.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.memberId, m.id),
    });
    expect(row!.usedAt).not.toBeNull();
    expect(userMock.clearUserCookie).toHaveBeenCalledTimes(1);
  });

  it("rejects a weak password with a passwordError before touching the token", async () => {
    await seedMember();
    const tok = await freshToken();
    const r = await resetPasswordWithToken({
      token: tok,
      newPassword: "short",
    });
    expect("passwordError" in r).toBe(true);
  });

  it("rejects an expired/used/garbage token with a tokenError", async () => {
    const r = await resetPasswordWithToken({
      token: "garbage",
      newPassword: "brandnewpass1",
    });
    expect("tokenError" in r).toBe(true);
  });

  it("is single-use: second reset with the same token fails (CAS)", async () => {
    await seedMember();
    const tok = await freshToken();
    const r1 = await resetPasswordWithToken({
      token: tok,
      newPassword: "brandnewpass1",
    });
    expect(r1).toEqual({ success: true });
    const r2 = await resetPasswordWithToken({
      token: tok,
      newPassword: "anothernew222",
    });
    expect("tokenError" in r2).toBe(true);
  });
});
