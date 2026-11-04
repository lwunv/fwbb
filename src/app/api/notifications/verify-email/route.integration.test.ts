import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { admins, members, notificationPrefs } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));
const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
const mailMock = vi.hoisted(() => ({
  sendMail: vi.fn(async (_m: { to: string; text: string }) => ({ ok: true })),
}));
vi.mock("@/lib/mailer", () => mailMock);
// Chạy callback ngay để kiểm mail đã được xếp.
const afterMock = vi.hoisted(() => ({
  runAfterResponse: vi.fn((fn: () => Promise<unknown>) => void fn()),
}));
vi.mock("@/lib/notifications/after", () => afterMock);

const { GET } = await import("./route");
const { sealVerifyToken, ensureUnsubToken } =
  await import("@/lib/notifications/tokens");
const { isEmailRecipientEligible } =
  await import("@/lib/notifications/email-eligibility");
const { requestNotifyEmailVerification, getMyNotificationPrefs } =
  await import("@/actions/notifications");
const { requireAdmin } = await import("@/lib/auth");

const ORIGIN = "http://localhost:3101";

async function reset() {
  for (const t of [
    "notification_prefs",
    "rate_limit_buckets",
    "admins",
    "members",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function addMember(email: string | null) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "M",
      facebookId: `fb-${Math.random()}`,
      isActive: true,
      approvalStatus: "approved",
      email,
    })
    .returning({ id: members.id });
  return m.id;
}

async function verifiedFor(id: number) {
  const [row] = await testDb
    .select({ v: members.notifyEmailVerifiedFor })
    .from(members)
    .where(eq(members.id, id));
  return row.v;
}

function call(token: string) {
  return GET(
    new NextRequest(
      `${ORIGIN}/api/notifications/verify-email?token=${encodeURIComponent(token)}`,
    ),
  );
}

function loc(res: Response) {
  const u = new URL(res.headers.get("location")!);
  return u.pathname + u.search;
}

const member = (id: number) => ({ type: "member", id }) as const;

afterEach(() => vi.unstubAllEnvs());

beforeEach(async () => {
  await reset();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
});

describe("GET /api/notifications/verify-email", () => {
  it("verifies the current email and redirects to /me?email=verified", async () => {
    const id = await addMember("Foo@Example.com");
    const res = await call(sealVerifyToken(id, "Foo@Example.com"));
    expect(res.status).toBe(303);
    expect(loc(res)).toBe("/me?email=verified");
    expect(await verifiedFor(id)).toBe("foo@example.com");
    expect(await isEmailRecipientEligible(testDb, member(id))).toEqual({
      to: "Foo@Example.com",
    });
  });

  it("verify link for an email the member has since changed does not verify", async () => {
    const id = await addMember("old@example.com");
    const token = sealVerifyToken(id, "old@example.com");
    await testDb
      .update(members)
      .set({ email: "new@example.com" })
      .where(eq(members.id, id));
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(loc(res)).toBe("/me?email=invalid");
    expect(await verifiedFor(id)).toBeNull();
  });

  it("rejects garbage and expired tokens", async () => {
    const id = await addMember("a@example.com");
    expect(loc(await call("nope"))).toBe("/me?email=invalid");
    const old = sealVerifyToken(id, "a@example.com", new Date("2026-01-01"));
    expect(loc(await call(old))).toBe("/me?email=invalid");
    expect(await verifiedFor(id)).toBeNull();
  });
});

describe("isEmailRecipientEligible", () => {
  it("admin changes a verified member's email: isEmailRecipientEligible returns null", async () => {
    const id = await addMember("v@example.com");
    await testDb
      .update(members)
      .set({ notifyEmailVerifiedFor: "v@example.com" })
      .where(eq(members.id, id));
    expect(await isEmailRecipientEligible(testDb, member(id))).toEqual({
      to: "v@example.com",
    });
    await testDb
      .update(members)
      .set({ email: "other@example.com" })
      .where(eq(members.id, id));
    expect(await isEmailRecipientEligible(testDb, member(id))).toBeNull();
  });

  it("is null for unverified members and disabled prefs; admin needs an email but no verification", async () => {
    const id = await addMember("u@example.com");
    expect(await isEmailRecipientEligible(testDb, member(id))).toBeNull();

    await testDb
      .update(members)
      .set({ notifyEmailVerifiedFor: "u@example.com" })
      .where(eq(members.id, id));
    await testDb.insert(notificationPrefs).values({
      recipientType: "member",
      recipientId: id,
      emailEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    expect(await isEmailRecipientEligible(testDb, member(id))).toBeNull();

    const [a] = await testDb
      .insert(admins)
      .values({ username: "adm", passwordHash: "x", role: "superadmin" })
      .returning({ id: admins.id });
    const admin = { type: "admin", id: a.id } as const;
    expect(await isEmailRecipientEligible(testDb, admin)).toBeNull();
    await testDb
      .update(admins)
      .set({ email: "adm@example.com" })
      .where(eq(admins.id, a.id));
    expect(await isEmailRecipientEligible(testDb, admin)).toEqual({
      to: "adm@example.com",
    });
  });
});

describe("ensureUnsubToken", () => {
  it("creates once and keeps the same token afterwards", async () => {
    const id = await addMember(null);
    const t1 = await ensureUnsubToken(testDb, member(id));
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await ensureUnsubToken(testDb, member(id))).toBe(t1);

    // Dòng prefs có sẵn nhưng chưa có token: được điền, không tạo dòng mới.
    const id2 = await addMember(null);
    await testDb.insert(notificationPrefs).values({
      recipientType: "member",
      recipientId: id2,
      updatedAt: new Date().toISOString(),
    });
    const t2 = await ensureUnsubToken(testDb, member(id2));
    expect(t2).not.toBe(t1);
    expect((await testDb.select().from(notificationPrefs)).length).toBe(2);
  });
});

describe("requestNotifyEmailVerification", () => {
  it("emails a working verify link and rate limits to 3 per hour", async () => {
    const id = await addMember("req@example.com");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      externalId: "x",
    });
    for (let i = 0; i < 3; i++) {
      expect(await requestNotifyEmailVerification()).toEqual({
        success: true,
      });
    }
    expect(await requestNotifyEmailVerification()).toEqual({
      error: "Too many requests",
    });
    expect(mailMock.sendMail).toHaveBeenCalledTimes(3);
    const arg = mailMock.sendMail.mock.calls[0][0];
    expect(arg.to).toBe("req@example.com");
    expect(arg.text).toContain("/api/notifications/verify-email?token=");
    const token = decodeURIComponent(
      arg.text.split("token=")[1].split("\n")[0],
    );
    expect(loc(await call(token))).toBe("/me?email=verified");
  });

  it("refuses without NEXT_PUBLIC_APP_URL or USER_COOKIE_SECRET: no rate limit slot used, no send scheduled", async () => {
    const id = await addMember("cfg@example.com");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      externalId: "x",
    });
    const buckets = async () =>
      (await client.execute("SELECT COUNT(*) AS n FROM rate_limit_buckets"))
        .rows[0].n;

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(await requestNotifyEmailVerification()).toEqual({
      error: "Verification unavailable",
    });
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);

    vi.stubEnv("USER_COOKIE_SECRET", "");
    expect(await requestNotifyEmailVerification()).toEqual({
      error: "Verification unavailable",
    });
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);

    expect(Number(await buckets())).toBe(0);
    expect(afterMock.runAfterResponse).not.toHaveBeenCalled();
    expect(mailMock.sendMail).not.toHaveBeenCalled();
  });

  it("errors without a session or an email; admin prefs report verified when admins.email is set", async () => {
    userMock.getUserFromCookie.mockResolvedValue(null);
    expect(await requestNotifyEmailVerification()).toEqual({
      error: "Unauthorized",
    });
    const id = await addMember(null);
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      externalId: "x",
    });
    expect(await requestNotifyEmailVerification()).toEqual({
      error: "No email",
    });
    expect(mailMock.sendMail).not.toHaveBeenCalled();

    const [a] = await testDb
      .insert(admins)
      .values({
        username: "adm2",
        passwordHash: "x",
        role: "superadmin",
        email: "a@x.co",
      })
      .returning({ id: admins.id });
    vi.mocked(requireAdmin).mockResolvedValue({
      admin: { sub: String(a.id) },
    } as never);
    const prefs = await getMyNotificationPrefs("admin");
    expect("error" in prefs).toBe(false);
    if (!("error" in prefs)) expect(prefs.emailVerified).toBe(true);
  });
});
