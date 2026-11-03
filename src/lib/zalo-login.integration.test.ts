/**
 * Đăng nhập Zalo tìm hoặc tạo member trong MỘT transaction thật. Hai callback
 * song song cùng uid không được sinh hai member, và một lần ghi identity hỏng
 * không được để lại member mồ côi (không có đường đăng nhập nào trỏ về).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities } from "@/db/schema";
import { eq } from "drizzle-orm";

const { db: testDb, client } = await createTestDb();
// Giống DB file thật (src/db/index.ts bật WAL). Ở journal mặc định, một BEGIN
// bị BUSY làm kẹt cả file cho mọi writer khác, nên bài song song không đo
// được hành vi thật của app.
await client.execute("PRAGMA journal_mode = WAL");
vi.mock("@/db", () => ({ db: testDb }));

const { loginOrCreateZaloMember } = await import("./zalo-login");

const UID = "8811223344556677";
const PIC = "https://s120-ava-talk.zadn.vn/a/b/c.jpg";

async function reset() {
  await client.execute("DROP TRIGGER IF EXISTS zalo_identity_boom");
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
}

async function countRows() {
  const m = await testDb.select({ id: members.id }).from(members);
  const i = await testDb
    .select({ id: memberOauthIdentities.id })
    .from(memberOauthIdentities);
  return { members: m.length, identities: i.length };
}

async function addZaloMember(opts: {
  approvalStatus?: "pending" | "approved" | "rejected";
  signupIntent?: "group" | "exchange";
  isActive?: boolean;
}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "Tên cũ",
      avatarUrl: "https://old.example/a.jpg",
      approvalStatus: opts.approvalStatus ?? "approved",
      signupIntent: opts.signupIntent ?? "group",
      isActive: opts.isActive ?? true,
    })
    .returning();
  await testDb
    .insert(memberOauthIdentities)
    .values({ memberId: m.id, provider: "zalo", providerUid: UID });
  return m;
}

describe("loginOrCreateZaloMember", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("uid mới → member pending, signup_intent=exchange, identity zalo", async () => {
    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "Lan Anh",
      pictureUrl: PIC,
      intent: "exchange",
    });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.created).toBe(true);

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, r.memberId),
    });
    expect(m).toMatchObject({
      name: "Lan Anh",
      avatarUrl: PIC,
      approvalStatus: "pending",
      signupIntent: "exchange",
      facebookId: null,
      googleId: null,
    });
    const ids = await testDb.query.memberOauthIdentities.findMany({
      where: eq(memberOauthIdentities.memberId, r.memberId),
    });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ provider: "zalo", providerUid: UID });
  });

  it("tên rỗng vẫn tạo được member với tên mặc định", async () => {
    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "   ",
      pictureUrl: null,
      intent: "exchange",
    });
    if ("error" in r) throw new Error("unexpected error");
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, r.memberId),
    });
    expect(m?.name).toBe("Zalo user");
    expect(m?.avatarUrl).toBeNull();
  });

  it("uid đã có → dùng lại, cập nhật tên/ảnh, KHÔNG đổi signup_intent hay approvalStatus", async () => {
    // Member nhóm đăng nhập từ trang giao lưu vẫn là member nhóm.
    const existing = await addZaloMember({
      approvalStatus: "approved",
      signupIntent: "group",
    });

    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "Tên mới",
      pictureUrl: PIC,
      intent: "exchange",
    });
    expect(r).toEqual({ memberId: existing.id, created: false });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, existing.id),
    });
    expect(m).toMatchObject({
      name: "Tên mới",
      avatarUrl: PIC,
      approvalStatus: "approved",
      signupIntent: "group",
    });
    expect(await countRows()).toEqual({ members: 1, identities: 1 });
  });

  it.each([
    ["bị khoá", { isActive: false }],
    ["bị từ chối", { approvalStatus: "rejected" as const }],
  ])("member %s → { error: blocked }, không sửa gì", async (_label, opts) => {
    const existing = await addZaloMember(opts);

    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "Tên mới",
      pictureUrl: PIC,
      intent: "exchange",
    });
    expect(r).toEqual({ error: "blocked" });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, existing.id),
    });
    expect(m).toEqual(existing);
    expect(await countRows()).toEqual({ members: 1, identities: 1 });
  });

  it("uid trùng facebook_id của member khác → tạo member MỚI, không đụng member kia", async () => {
    const [fb] = await testDb
      .insert(members)
      .values({ name: "FbUser", facebookId: UID, avatarUrl: null })
      .returning();

    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "Lan Anh",
      pictureUrl: PIC,
      intent: "exchange",
    });
    if ("error" in r) throw new Error("unexpected error");
    expect(r.created).toBe(true);
    expect(r.memberId).not.toBe(fb.id);

    const fbAfter = await testDb.query.members.findFirst({
      where: eq(members.id, fb.id),
    });
    expect(fbAfter).toEqual(fb);
    const fbIds = await testDb.query.memberOauthIdentities.findMany({
      where: eq(memberOauthIdentities.memberId, fb.id),
    });
    expect(fbIds).toHaveLength(0);
  });

  it("2 lần gọi song song cùng uid → đúng 1 member, đúng 1 identity", async () => {
    const input = {
      uid: UID,
      name: "Lan Anh",
      pictureUrl: PIC,
      intent: "exchange" as const,
    };
    const results = await Promise.all([
      loginOrCreateZaloMember(input),
      loginOrCreateZaloMember(input),
    ]);

    expect(await countRows()).toEqual({ members: 1, identities: 1 });
    const ok = results.filter(
      (r): r is { memberId: number; created: boolean } => !("error" in r),
    );
    expect(ok).toHaveLength(2);
    expect(ok[0].memberId).toBe(ok[1].memberId);
    expect(ok.filter((r) => r.created)).toHaveLength(1);
  });

  it("thua cuộc đua UNIQUE (đọc thấy chưa có rồi insert identity đụng UNIQUE) → không để lại member, trả member thắng", async () => {
    // Giả lập trường hợp transaction không khoá ghi từ đầu: lần đọc trong tx
    // không thấy identity, trong khi bên thắng đã commit cả member lẫn
    // identity. Lần insert identity phải đụng UNIQUE thật của DB.
    const winner = await addZaloMember({
      approvalStatus: "pending",
      signupIntent: "exchange",
    });
    const realTransaction = testDb.transaction.bind(testDb);
    vi.spyOn(testDb, "transaction").mockImplementationOnce((cb) =>
      realTransaction(async (tx) => {
        tx.query.memberOauthIdentities.findFirst = (async () =>
          undefined) as unknown as typeof tx.query.memberOauthIdentities.findFirst;
        return cb(tx);
      }),
    );

    const r = await loginOrCreateZaloMember({
      uid: UID,
      name: "Lan Anh",
      pictureUrl: PIC,
      intent: "exchange",
    });
    expect(r).toEqual({ memberId: winner.id, created: false });
    expect(await countRows()).toEqual({ members: 1, identities: 1 });
  });

  it("insert identity ném lỗi → bảng members không có dòng mới", async () => {
    await client.execute(`CREATE TRIGGER zalo_identity_boom
      BEFORE INSERT ON member_oauth_identities
      BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(
      loginOrCreateZaloMember({
        uid: UID,
        name: "Lan Anh",
        pictureUrl: PIC,
        intent: "exchange",
      }),
    ).rejects.toThrow();
    expect(await countRows()).toEqual({ members: 0, identities: 0 });
  });
});
