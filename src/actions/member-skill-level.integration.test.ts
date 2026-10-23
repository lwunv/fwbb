/**
 * Member tự khai trình độ (`updateMySkillLevel`).
 *
 * Ba điều được khoá ở đây, đều là chuyện âm thầm nếu sai:
 * 1. Chuỗi rỗng = bỏ khai, ghi NULL chứ không ghi chuỗi rỗng xuống DB.
 * 2. Giá trị lạ phải BÁO LỖI. Cả "bỏ khai" lẫn "giá trị lạ" đều ra NULL, nên
 *    nếu nuốt lỗi thì một lần gọi sai sẽ xoá lựa chọn của member mà không ai
 *    biết.
 * 3. Đổi trình độ KHÔNG được đụng tới biệt danh hay cờ "đi 2 người". Đây là lý
 *    do hàm này tách riêng thay vì dùng chung `updateMyProfile`.
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

const identity = vi.hoisted(() => ({
  getUserFromCookie: vi.fn(async () => null as { memberId: number } | null),
}));
vi.mock("@/lib/user-identity", () => identity);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { updateMySkillLevel, updateMember } = await import("./members");

let memberId: number;

beforeEach(async () => {
  await client.execute("DELETE FROM rate_limit_buckets");
  await client.execute("DELETE FROM members");
  const [m] = await testDb
    .insert(members)
    .values({
      name: "Người test",
      nickname: "Bi",
      defaultWithPartner: true,
    })
    .returning({ id: members.id });
  memberId = m.id;
  identity.getUserFromCookie.mockResolvedValue({ memberId });
});

async function row() {
  return testDb.query.members.findFirst({ where: eq(members.id, memberId) });
}

describe("member tự khai trình độ", () => {
  it("lưu được mức hợp lệ", async () => {
    const r = await updateMySkillLevel("tby");
    expect(r).toEqual({ success: true });
    expect((await row())?.skillLevel).toBe("tby");
  });

  it("đổi sang mức khác thì ghi đè mức cũ", async () => {
    await updateMySkillLevel("yeu");
    await updateMySkillLevel("tbk");
    expect((await row())?.skillLevel).toBe("tbk");
  });

  it("chuỗi rỗng = bỏ khai, cột về NULL chứ không phải chuỗi rỗng", async () => {
    await updateMySkillLevel("tb");
    const r = await updateMySkillLevel("");
    expect(r).toEqual({ success: true });

    const raw = await client.execute({
      sql: "SELECT skill_level, typeof(skill_level) AS t FROM members WHERE id = ?",
      args: [memberId],
    });
    expect(raw.rows[0].skill_level).toBeNull();
    expect(raw.rows[0].t).toBe("null");
  });

  it("giá trị lạ bị TỪ CHỐI và không đụng tới mức đang có", async () => {
    await updateMySkillLevel("tb");

    for (const junk of ["pro", "TB", " tb", "null", "0"]) {
      const r = await updateMySkillLevel(junk);
      expect(r, junk).toHaveProperty("error");
      expect((await row())?.skillLevel, junk).toBe("tb");
    }
  });

  it("chưa đăng nhập thì không ghi gì", async () => {
    identity.getUserFromCookie.mockResolvedValue(null);
    const r = await updateMySkillLevel("tb");
    expect(r).toHaveProperty("error");
    expect((await row())?.skillLevel).toBeNull();
  });

  it("KHÔNG đụng tới biệt danh và cờ đi-2-người", async () => {
    await updateMySkillLevel("tbk");
    const m = await row();
    expect(m?.nickname).toBe("Bi");
    expect(m?.defaultWithPartner).toBe(true);
  });

  it("chỉ sửa chính mình, không đụng member khác", async () => {
    const [other] = await testDb
      .insert(members)
      .values({ name: "Người khác", skillLevel: "yeu" })
      .returning({ id: members.id });

    await updateMySkillLevel("tb");

    const o = await testDb.query.members.findFirst({
      where: eq(members.id, other.id),
    });
    expect(o?.skillLevel).toBe("yeu");
  });
});

describe("admin khai trình độ hộ member", () => {
  /** Form "Sửa thông tin thành viên" luôn gửi đủ các field của nó. */
  function infoForm(extra: Record<string, string>) {
    const fd = new FormData();
    fd.set("name", "Người test");
    fd.set("nickname", "Bi");
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  it("đặt được trình độ cho member", async () => {
    const r = await updateMember(memberId, infoForm({ skillLevel: "tby" }));
    expect(r).not.toHaveProperty("error");
    expect((await row())?.skillLevel).toBe("tby");
  });

  it("để trống thì xoá khai báo, về NULL", async () => {
    await updateMember(memberId, infoForm({ skillLevel: "tb" }));
    await updateMember(memberId, infoForm({ skillLevel: "" }));
    expect((await row())?.skillLevel).toBeNull();
  });

  it("giá trị lạ bị TỪ CHỐI, mức đang có giữ nguyên", async () => {
    await updateMember(memberId, infoForm({ skillLevel: "tb" }));
    const r = await updateMember(memberId, infoForm({ skillLevel: "pro" }));
    expect(r).toHaveProperty("error");
    expect((await row())?.skillLevel).toBe("tb");
  });

  it("form KHÔNG gửi field thì giữ nguyên lựa chọn của member", async () => {
    // Admin sửa mỗi cái tên thì không được xoá mất trình độ member tự chọn.
    await updateMySkillLevel("tbk");
    await updateMember(memberId, infoForm({}));
    expect((await row())?.skillLevel).toBe("tbk");
  });
});

describe("giới tính LGBT", () => {
  function infoForm(gender: string) {
    const fd = new FormData();
    fd.set("name", "Người test");
    fd.set("nickname", "Bi");
    fd.set("gender", gender);
    return fd;
  }

  it("admin đặt được LGBT", async () => {
    const r = await updateMember(memberId, infoForm("lgbt"));
    expect(r).not.toHaveProperty("error");
    expect((await row())?.gender).toBe("lgbt");
  });

  it("nam và nữ vẫn đặt được như cũ", async () => {
    await updateMember(memberId, infoForm("male"));
    expect((await row())?.gender).toBe("male");
    await updateMember(memberId, infoForm("female"));
    expect((await row())?.gender).toBe("female");
  });

  it("giá trị lạ vẫn bị chặn", async () => {
    await updateMember(memberId, infoForm("female"));
    const r = await updateMember(memberId, infoForm("khac"));
    expect(r).toHaveProperty("error");
    expect((await row())?.gender).toBe("female");
  });
});
