/**
 * Admin khai giới tính cho thành viên (`updateMember`).
 *
 * Ba trạng thái: chưa khai (null), nam, nữ. Hai điểm dễ sai được khoá ở đây:
 * bỏ trống phải ra NULL chứ không phải chuỗi rỗng, và form KHÔNG gửi field
 * `gender` thì giá trị cũ phải giữ nguyên (cùng pattern `formData.has()` mà
 * `withPartner`/`email` đang dùng — mất pattern này là sửa nickname cũng nuke
 * luôn giới tính).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";

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

const { updateMember } = await import("./members");

beforeEach(async () => {
  await client.execute("DELETE FROM members");
});

async function seed(gender: "male" | "female" | null = null) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Người test", gender })
    .returning({ id: members.id });
  return m.id;
}

async function genderOf(id: number) {
  const row = await testDb.query.members.findFirst({
    where: eq(members.id, id),
  });
  return row?.gender ?? null;
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("updateMember — giới tính", () => {
  it("khai nữ thì lưu nữ", async () => {
    const id = await seed();
    const r = await updateMember(
      id,
      form({ name: "Người test", gender: "female" }),
    );
    expect(r).not.toHaveProperty("error");
    expect(await genderOf(id)).toBe("female");
  });

  it("khai nam thì lưu nam", async () => {
    const id = await seed();
    await updateMember(id, form({ name: "Người test", gender: "male" }));
    expect(await genderOf(id)).toBe("male");
  });

  it("chọn lại 'chưa khai' (gửi rỗng) thì về NULL, không phải chuỗi rỗng", async () => {
    const id = await seed("female");
    await updateMember(id, form({ name: "Người test", gender: "" }));
    expect(await genderOf(id)).toBeNull();
  });

  it("form KHÔNG gửi field gender thì giữ nguyên giá trị cũ", async () => {
    const id = await seed("female");
    // Sửa mỗi biệt danh, không đụng giới tính.
    await updateMember(id, form({ name: "Người test", nickname: "Tên khác" }));
    expect(await genderOf(id)).toBe("female");
  });

  it("giá trị lạ bị từ chối, KHÔNG ghi gì", async () => {
    const id = await seed("male");
    const r = await updateMember(
      id,
      form({ name: "Người test", gender: "khac" }),
    );
    expect(r).toHaveProperty("error");
    expect(await genderOf(id)).toBe("male");
  });
});
