import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, dupIgnoredPairs } from "@/db/schema";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { findDuplicateMembers, ignoreDuplicateGroup } =
  await import("./members");

async function reset() {
  await client.execute("DELETE FROM dup_ignored_pairs");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM members");
}

async function mkMember(name: string): Promise<number> {
  const [m] = await testDb
    .insert(members)
    .values({ name })
    .returning({ id: members.id });
  return m.id;
}

describe("dup ignore (Bỏ qua)", () => {
  beforeEach(reset);

  it("2 member trùng tên → hiện 1 nhóm; bỏ qua → ẩn hẳn", async () => {
    const a = await mkMember("Liên");
    const b = await mkMember("Liên");
    await mkMember("Khác"); // tên khác, không vào nhóm

    let groups = await findDuplicateMembers();
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([a, b].sort());

    const res = await ignoreDuplicateGroup([a, b]);
    expect(res).toEqual({ success: true });

    groups = await findDuplicateMembers();
    expect(groups).toHaveLength(0); // nhóm 2 người, bỏ qua cặp → biến mất
  });

  it("chuẩn hoá low<high bất kể thứ tự truyền vào (1 dòng duy nhất)", async () => {
    const a = await mkMember("Nam");
    const b = await mkMember("Nam");
    await ignoreDuplicateGroup([b, a]); // truyền ngược thứ tự
    const rows = await testDb.select().from(dupIgnoredPairs);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberIdLow).toBe(Math.min(a, b));
    expect(rows[0].memberIdHigh).toBe(Math.max(a, b));
  });

  it("idempotent: bỏ qua 2 lần không lỗi, không nhân đôi", async () => {
    const a = await mkMember("Tùng");
    const b = await mkMember("Tùng");
    await ignoreDuplicateGroup([a, b]);
    const res2 = await ignoreDuplicateGroup([a, b]);
    expect(res2).toEqual({ success: true });
    const rows = await testDb.select().from(dupIgnoredPairs);
    expect(rows).toHaveLength(1);
  });

  it("nhóm 3: bỏ qua CẢ nhóm → ẩn; nhưng chỉ bỏ 1 cặp → vẫn hiện đủ 3", async () => {
    const a = await mkMember("Sơn");
    const b = await mkMember("Sơn");
    const c = await mkMember("Sơn");

    // Chỉ bỏ 1 cặp (a,b): a còn partner c, b còn partner c, c còn cả 2 → giữ 3.
    await ignoreDuplicateGroup([a, b]);
    let groups = await findDuplicateMembers();
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);

    // Bỏ qua cả nhóm (mọi cặp) → không ai còn partner chưa-ignore → ẩn.
    await ignoreDuplicateGroup([a, b, c]);
    groups = await findDuplicateMembers();
    expect(groups).toHaveLength(0);
  });

  it("chặn input không hợp lệ (<2 id)", async () => {
    const res = await ignoreDuplicateGroup([1]);
    expect(res).toHaveProperty("error");
    const rows = await testDb.select().from(dupIgnoredPairs);
    expect(rows).toHaveLength(0);
  });
});
