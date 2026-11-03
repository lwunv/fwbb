/**
 * Zalo uid không bao giờ được khớp qua cột legacy members.facebook_id: hai
 * provider có không gian uid riêng, trùng chuỗi chỉ là ngẫu nhiên và sẽ cho
 * người lạ đăng nhập vào hồ sơ Facebook của member khác.
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
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
  setUserCookie: vi.fn(),
  clearUserCookie: vi.fn(),
}));
import { getUserFromCookie } from "@/lib/user-identity";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { findMemberByOAuth, oauthLinkState } =
  await import("@/lib/oauth-identity");
const { unlinkOAuthIdentity } = await import("@/actions/members");

const UID = "1234567890123456";

async function reset() {
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
}

describe("provider zalo", () => {
  beforeEach(reset);

  it("findMemberByOAuth(zalo, uid) KHÔNG khớp member có facebook_id = uid", async () => {
    await testDb.insert(members).values({ name: "FbUser", facebookId: UID });
    expect(await findMemberByOAuth("zalo", UID)).toBeNull();
    // facebook vẫn giữ fallback legacy như trước.
    expect((await findMemberByOAuth("facebook", UID))?.name).toBe("FbUser");
  });

  it("findMemberByOAuth(zalo, uid) khớp qua identity row", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "ZaloUser" })
      .returning({ id: members.id });
    await testDb
      .insert(memberOauthIdentities)
      .values({ memberId: m.id, provider: "zalo", providerUid: UID });
    expect((await findMemberByOAuth("zalo", UID))?.id).toBe(m.id);
  });

  it("oauthLinkState(zalo) = free khi uid trùng facebook_id của member khác", async () => {
    const [fb] = await testDb
      .insert(members)
      .values({ name: "FbUser", facebookId: UID })
      .returning({ id: members.id });
    const [self] = await testDb
      .insert(members)
      .values({ name: "Self" })
      .returning({ id: members.id });
    expect(await oauthLinkState("zalo", UID, self.id)).toEqual({
      state: "free",
    });
    expect(await oauthLinkState("facebook", UID, self.id)).toEqual({
      state: "other",
      memberId: fb.id,
    });
  });

  it("unlinkOAuthIdentity(zalo) không xoá members.facebook_id", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Both", facebookId: UID, passwordHash: "hash" })
      .returning({ id: members.id });
    await testDb
      .insert(memberOauthIdentities)
      .values({ memberId: m.id, provider: "zalo", providerUid: UID });
    vi.mocked(getUserFromCookie).mockResolvedValue({
      memberId: m.id,
      externalId: "",
    });
    const idn = await testDb.query.memberOauthIdentities.findFirst({
      where: eq(memberOauthIdentities.providerUid, UID),
    });

    expect(await unlinkOAuthIdentity(idn!.id)).toEqual({ success: true });
    const after = await testDb.query.members.findFirst({
      where: eq(members.id, m.id),
    });
    expect(after?.facebookId).toBe(UID);
  });
});
