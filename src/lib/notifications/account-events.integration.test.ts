import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  memberOauthIdentities,
  members,
  notificationPrefs,
  notifications,
  venues,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  setUserCookie: vi.fn(async () => {}),
  clearUserCookie: vi.fn(async () => {}),
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/maps-link-resolve", () => ({ resolveMapsLink: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  approveMember,
  rejectMember,
  approveAndMergeMember,
  declineGroupRequest,
} = await import("@/actions/member-approval");
const { signupWithPassword } = await import("@/actions/password-auth");
const { unlinkOAuthIdentity, mergeMember } = await import("@/actions/members");
const { submitVenue, setVenueStatus } = await import("@/actions/venues");
const { loginOrCreateZaloMember } = await import("@/lib/zalo-login");
const { notifyMemberAccount, notifySignupPending } =
  await import("./account-events");
const { enableNotificationsForTest } = await import("./test-helpers");

async function reset() {
  for (const t of [
    "notifications",
    "notification_prefs",
    "venues",
    "member_oauth_identities",
    "admins",
    "members",
    "app_settings",
    "rate_limit_buckets",
  ]) {
    await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
  }
  userMock.getUserFromCookie.mockReset();
}

let seq = 0;
async function addMember(values: Partial<typeof members.$inferInsert> = {}) {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({ name: `M${seq}`, facebookId: `fb-${seq}`, ...values })
    .returning({ id: members.id });
  return m.id;
}

async function addSuperadmin() {
  const [a] = await testDb
    .insert(admins)
    .values({ username: `sa${++seq}`, passwordHash: "x", role: "superadmin" })
    .returning({ id: admins.id });
  return a.id;
}

async function notes(kind?: string) {
  const all = await testDb.select().from(notifications);
  return kind ? all.filter((n) => n.kind === kind) : all;
}

describe("account, signup and venue notifications", () => {
  beforeEach(async () => {
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("approve twice sends one account_approved", async () => {
    const id = await addMember({ approvalStatus: "pending" });
    await approveMember(id);
    await approveMember(id);
    const rows = await notes("account_approved");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientType: "member", recipientId: id });
  });

  it("reject notifies a pending member once", async () => {
    const id = await addMember({ approvalStatus: "pending" });
    await rejectMember(id);
    await rejectMember(id);
    expect(await notes("account_rejected")).toHaveLength(1);
  });

  it("sends nothing while notificationsEnabled is off", async () => {
    await client.execute("DELETE FROM app_settings");
    const id = await addMember({ approvalStatus: "pending" });
    await approveMember(id);
    expect(await notes()).toHaveLength(0);
  });

  it("approveAndMergeMember: target receives account_merged and the pending member's earlier notifications now belong to the target", async () => {
    const pending = await addMember({ approvalStatus: "pending" });
    const target = await addMember();
    await testDb.insert(notificationPrefs).values({
      recipientType: "member",
      recipientId: pending,
      mutedGroups: ["venue"],
      updatedAt: new Date().toISOString(),
    } as never);
    await notifyMemberAccount(testDb, {
      kind: "password_changed",
      memberId: pending,
      dedupBase: `pwd:m${pending}`,
    });
    const r = await approveAndMergeMember(pending, target);
    expect(r).toHaveProperty("success", true);

    const rows = await notes();
    expect(rows.map((n) => n.recipientId)).toEqual([target, target]);
    expect(rows.map((n) => n.kind).sort()).toEqual([
      "account_merged",
      "password_changed",
    ]);
    const prefs = await testDb
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.recipientId, pending));
    expect(prefs).toHaveLength(0);
  });

  it("mergeMember moves the source member's notifications to the target", async () => {
    const source = await addMember();
    const target = await addMember();
    await notifyMemberAccount(testDb, {
      kind: "password_changed",
      memberId: source,
      dedupBase: `pwd:m${source}`,
    });
    const r = await mergeMember(source, target);
    expect(r).toHaveProperty("success", true);
    const rows = await notes("password_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientId).toBe(target);
  });

  it("password signup with group intent notifies superadmins; Zalo exchange signup does not", async () => {
    const admin = await addSuperadmin();
    const r = await signupWithPassword({
      name: "Alice",
      email: "alice@example.com",
      password: "supersecret123",
    });
    expect("error" in r).toBe(false);
    const rows = await notes("signup_pending");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientType: "admin",
      recipientId: admin,
    });
    expect(rows[0].payload).toMatchObject({
      memberName: "Alice",
      provider: "password",
    });

    const z = await loginOrCreateZaloMember({
      uid: "zalo-1",
      name: "Zed",
      pictureUrl: null,
      intent: "exchange",
    });
    expect(z).toHaveProperty("created", true);
    const zid = (z as { memberId: number }).memberId;
    // Helper tự chặn ý định giao lưu (Google dùng chung đường này).
    await notifySignupPending(testDb, {
      memberId: zid,
      provider: "google",
      signupIntent: "exchange",
    });
    expect(await notes("signup_pending")).toHaveLength(1);
  });

  it("declineGroupRequest notifies the account once", async () => {
    const id = await addMember({ approvalStatus: "pending" });
    expect(await declineGroupRequest(id)).toHaveProperty("success", true);
    expect(await declineGroupRequest(id)).toHaveProperty("error");
    expect(await notes("group_request_declined")).toHaveLength(1);
  });

  it("submitVenue notifies superadmins once; setVenueStatus approved notifies only the submitter", async () => {
    const admin = await addSuperadmin();
    const proposer = await addMember({ name: "Chi" });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: proposer,
      externalId: "x",
    });
    const r = await submitVenue({ name: "Sân A", lat: 21.03, lng: 105.85 });
    expect(r).toHaveProperty("success", true);
    const pending = await notes("venue_pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      recipientType: "admin",
      recipientId: admin,
    });
    expect(pending[0].payload).toMatchObject({
      venueName: "Sân A",
      proposerName: "Chi",
    });

    const [v] = await testDb.select({ id: venues.id }).from(venues);
    await setVenueStatus(v.id, "approved");
    await setVenueStatus(v.id, "approved");
    const approved = await notes("venue_approved");
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({
      recipientType: "member",
      recipientId: proposer,
    });
    expect(approved[0].payload).toMatchObject({ venueName: "Sân A" });

    await setVenueStatus(v.id, "hidden");
    expect(await notes("venue_hidden")).toHaveLength(1);
  });

  it("unlinking the last login method rolls back and sends nothing", async () => {
    const id = await addMember({ googleId: "g-1" });
    await testDb.insert(memberOauthIdentities).values({
      memberId: id,
      provider: "google",
      providerUid: "g-1",
    });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      externalId: "",
    });
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-1"),
    });
    const r = await unlinkOAuthIdentity(idn!.id);
    expect(r).toHaveProperty("error");
    expect(await notes()).toHaveLength(0);
    expect(
      await testDb
        .select()
        .from(memberOauthIdentities)
        .where(eq(memberOauthIdentities.memberId, id)),
    ).toHaveLength(1);
  });

  it("unlinking one of two methods sends login_method_unlinked", async () => {
    const id = await addMember({ passwordHash: "hash" });
    await testDb.insert(memberOauthIdentities).values({
      memberId: id,
      provider: "google",
      providerUid: "g-2",
    });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      externalId: "",
    });
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, "g-2"),
    });
    expect(await unlinkOAuthIdentity(idn!.id)).toHaveProperty("success", true);
    const rows = await notes("login_method_unlinked");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ provider: "Google" });
  });
});
