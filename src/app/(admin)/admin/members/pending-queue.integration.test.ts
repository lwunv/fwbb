/**
 * Hàng chờ duyệt, số trên sidebar và danh sách chính của admin phải bỏ qua tài
 * khoản giao lưu (pending + exchange) mà KHÔNG làm mất pending nhóm như cũ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, memberOauthIdentities } from "@/db/schema";

const identity = vi.hoisted(() => ({
  current: null as { memberId: number; externalId: string } | null,
}));
const flag = vi.hoisted(() => ({ on: true }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => identity.current),
  clearUserCookie: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => flag.on),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  loadPendingGroupRows,
  countPendingGroupMembers,
  splitExchangeAccounts,
  loadIdentityProviders,
} = await import("./pending-queue");
const { getMembers } = await import("@/actions/members");
const { requestGroupMembership } = await import("@/actions/member-approval");

async function seed(
  name: string,
  approvalStatus: "pending" | "approved" | "rejected",
  signupIntent: "group" | "exchange",
) {
  const [m] = await testDb
    .insert(members)
    .values({ name, approvalStatus, signupIntent })
    .returning({ id: members.id });
  return m.id;
}

beforeEach(async () => {
  identity.current = null;
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM member_oauth_identities");
  await client.execute("DELETE FROM members");
});

describe("hàng chờ duyệt", () => {
  it("pending group có, pending exchange không có", async () => {
    await seed("Chờ nhóm", "pending", "group");
    await seed("Chỉ giao lưu", "pending", "exchange");
    await seed("Đã duyệt", "approved", "group");
    const rows = await loadPendingGroupRows();
    expect(rows.map((r) => r.name)).toEqual(["Chờ nhóm"]);
  });

  it("số sidebar chỉ đếm pending group", async () => {
    await seed("A", "pending", "group");
    await seed("B", "pending", "group");
    await seed("C", "pending", "exchange");
    await seed("D", "approved", "group");
    expect(await countPendingGroupMembers()).toBe(2);
  });

  it("sau requestGroupMembership: member xuất hiện trong hàng chờ và danh sách chính", async () => {
    const id = await seed("Xin vào nhóm", "pending", "exchange");
    expect(await loadPendingGroupRows()).toHaveLength(0);
    expect(await countPendingGroupMembers()).toBe(0);

    identity.current = { memberId: id, externalId: `ext-${id}` };
    expect(await requestGroupMembership()).toEqual({ success: true });

    const queue = await loadPendingGroupRows();
    expect(queue.map((r) => r.id)).toEqual([id]);
    expect(await countPendingGroupMembers()).toBe(1);

    const { regular, exchange } = splitExchangeAccounts(await getMembers());
    expect(regular.map((m) => m.id)).toContain(id);
    expect(exchange).toHaveLength(0);
  });
});

describe("danh sách chính", () => {
  it("danh sách chính và số Tất cả không gồm tài khoản giao lưu", async () => {
    const pendingGroup = await seed("Chờ nhóm", "pending", "group");
    const approved = await seed("Đã duyệt", "approved", "group");
    const rejected = await seed("Bị từ chối", "rejected", "group");
    const exch = await seed("Chỉ giao lưu", "pending", "exchange");

    const { regular, exchange } = splitExchangeAccounts(await getMembers());
    expect(regular.map((m) => m.id).sort()).toEqual(
      [pendingGroup, approved, rejected].sort(),
    );
    expect(regular).toHaveLength(3);
    expect(exchange.map((m) => m.id)).toEqual([exch]);
  });
});

describe("loadIdentityProviders", () => {
  it("nạp provider của các id được hỏi trong một lượt, bỏ id khác", async () => {
    const a = await seed("A", "pending", "group");
    const b = await seed("B", "pending", "exchange");
    const other = await seed("Khác", "approved", "group");
    await testDb.insert(memberOauthIdentities).values([
      { memberId: a, provider: "zalo", providerUid: "z-a" },
      { memberId: a, provider: "google", providerUid: "g-a" },
      { memberId: b, provider: "zalo", providerUid: "z-b" },
      { memberId: other, provider: "facebook", providerUid: "f-o" },
    ]);

    const map = await loadIdentityProviders([a, b]);
    expect([...(map[a] ?? [])].sort()).toEqual(["google", "zalo"]);
    expect(map[b]).toEqual(["zalo"]);
    expect(map[other]).toBeUndefined();
    expect(await loadIdentityProviders([])).toEqual({});
  });
});
