/**
 * "Xin vào nhóm" của tài khoản giao lưu (g2a, Task 11). Hành động này đổi
 * `signupIntent` từ "exchange" sang "group" để member hiện trong hàng chờ của
 * admin; nó KHÔNG được tự duyệt ai và không được động tới người đã vào nhóm.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

const identity = vi.hoisted(() => ({
  current: null as { memberId: number; externalId: string } | null,
}));
const flag = vi.hoisted(() => ({ on: true }));
const revalidate = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("next/cache", () => revalidate);
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => identity.current),
  clearUserCookie: vi.fn(),
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => flag.on),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { requestGroupMembership } = await import("./member-approval");

async function seed(values: Partial<typeof members.$inferInsert> = {}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: "Tester",
      approvalStatus: "pending",
      signupIntent: "exchange",
      ...values,
    })
    .returning({ id: members.id });
  identity.current = { memberId: m.id, externalId: `ext-${m.id}` };
  return m.id;
}

async function row(id: number) {
  const m = await testDb.query.members.findFirst({
    where: eq(members.id, id),
  });
  return { intent: m?.signupIntent, status: m?.approvalStatus };
}

beforeEach(async () => {
  identity.current = null;
  flag.on = true;
  revalidate.revalidatePath.mockClear();
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM members");
});

describe("requestGroupMembership", () => {
  it("pending exchange → signup_intent=group, vẫn pending, revalidate 3 trang", async () => {
    const id = await seed();
    expect(await requestGroupMembership()).toEqual({ success: true });
    expect(await row(id)).toEqual({ intent: "group", status: "pending" });
    const paths = revalidate.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining(["/admin/members", "/exchanges", "/"]),
    );
  });

  it("pending group → success, không đổi, không revalidate", async () => {
    const id = await seed({ signupIntent: "group" });
    expect(await requestGroupMembership()).toEqual({ success: true });
    expect(await row(id)).toEqual({ intent: "group", status: "pending" });
    expect(revalidate.revalidatePath).not.toHaveBeenCalled();
  });

  it("approved → success, không đổi signup_intent", async () => {
    const id = await seed({ approvalStatus: "approved" });
    expect(await requestGroupMembership()).toEqual({ success: true });
    expect(await row(id)).toEqual({ intent: "exchange", status: "approved" });
    expect(revalidate.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejected → error, không đổi", async () => {
    const id = await seed({ approvalStatus: "rejected" });
    expect(await requestGroupMembership()).toHaveProperty("error");
    expect(await row(id)).toEqual({ intent: "exchange", status: "rejected" });
  });

  it("isActive=false → error, không đổi", async () => {
    const id = await seed({ isActive: false });
    expect(await requestGroupMembership()).toHaveProperty("error");
    expect(await row(id)).toEqual({ intent: "exchange", status: "pending" });
  });

  it("không cookie → error", async () => {
    expect(await requestGroupMembership()).toHaveProperty("error");
  });

  it("cờ tắt → error, không đổi, không chạm DB", async () => {
    const id = await seed();
    flag.on = false;
    expect(await requestGroupMembership()).toHaveProperty("error");
    expect(await row(id)).toEqual({ intent: "exchange", status: "pending" });
  });

  it("gọi dồn dập bị chặn bởi rate limit", async () => {
    await seed({ signupIntent: "group" });
    for (let i = 0; i < 10; i++) {
      expect(await requestGroupMembership()).toEqual({ success: true });
    }
    expect(await requestGroupMembership()).toHaveProperty("error");
  });
});
