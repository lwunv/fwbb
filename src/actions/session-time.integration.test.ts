/**
 * `setSessionTime` — đổi giờ chơi của một buổi đã tạo (yêu cầu 01/11/2026).
 *
 * Trước đó giờ chơi chỉ đặt được lúc TẠO buổi. Tạo nhầm giờ thì cách duy nhất
 * là xoá buổi rồi tạo lại, mà xoá buổi kéo theo hoàn các khoản đã trừ quỹ và
 * mất sạch lượt vote của mọi người.
 *
 * User chốt phạm vi: buổi **chưa đóng, chưa chốt** thì sửa được. Nên hai ca
 * đáng khoá nhất ở đây là hai ca CHẶN: buổi đã chốt sổ và buổi đã huỷ. Sửa
 * được giờ của một buổi đã chốt sổ là sửa dữ liệu mà sổ sách đã dựa vào.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { sessions } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { setSessionTime } = await import("./sessions");

async function makeSession(status: string): Promise<number> {
  const r = await client.execute({
    sql: `INSERT INTO sessions (date, start_time, end_time, status, court_quantity, court_price)
          VALUES ('2026-11-06', '20:30', '22:30', ?, 1, 200000)`,
    args: [status],
  });
  return Number(r.lastInsertRowid);
}

async function readTime(id: number) {
  const s = await testDb.query.sessions.findFirst({
    where: eq(sessions.id, id),
    columns: { startTime: true, endTime: true },
  });
  return `${s?.startTime}–${s?.endTime}`;
}

beforeEach(async () => {
  await client.execute("DELETE FROM sessions");
});

describe("buổi còn sửa được", () => {
  it("buổi đang vote: đổi được giờ, ghi xuống DB", async () => {
    const id = await makeSession("voting");
    const r = await setSessionTime(id, "19:00", "21:00");
    expect(r).toEqual({ success: true });
    expect(await readTime(id)).toBe("19:00–21:00");
  });

  it("buổi đã xác nhận: vẫn đổi được (user chốt 01/11/2026)", async () => {
    const id = await makeSession("confirmed");
    const r = await setSessionTime(id, "18:30", "20:30");
    expect(r).toEqual({ success: true });
    expect(await readTime(id)).toBe("18:30–20:30");
  });

  it("buổi qua nửa đêm: 22:30 đến 00:30 là hợp lệ", async () => {
    const id = await makeSession("voting");
    const r = await setSessionTime(id, "22:30", "00:30");
    expect(r).toEqual({ success: true });
    expect(await readTime(id)).toBe("22:30–00:30");
  });
});

describe("buổi KHÔNG được sửa", () => {
  it("đã chốt sổ: từ chối và giữ nguyên giờ cũ", async () => {
    const id = await makeSession("completed");
    const r = await setSessionTime(id, "19:00", "21:00");
    expect(r).toHaveProperty("error");
    expect(await readTime(id)).toBe("20:30–22:30");
  });

  it("đã huỷ: từ chối và giữ nguyên giờ cũ", async () => {
    const id = await makeSession("cancelled");
    const r = await setSessionTime(id, "19:00", "21:00");
    expect(r).toHaveProperty("error");
    expect(await readTime(id)).toBe("20:30–22:30");
  });

  it("buổi không tồn tại: báo lỗi, không tạo mới", async () => {
    const r = await setSessionTime(999999, "19:00", "21:00");
    expect(r).toHaveProperty("error");
    const all = await client.execute("SELECT COUNT(*) AS n FROM sessions");
    expect(all.rows[0].n).toBe(0);
  });
});

describe("kiểm giá trị trước khi ghi", () => {
  it.each([
    ["25:00", "22:30", "giờ quá 23"],
    ["20:60", "22:30", "phút quá 59"],
    ["8:30", "22:30", "thiếu số 0 đầu"],
    ["20:30", "", "giờ kết thúc rỗng"],
    ["", "22:30", "giờ bắt đầu rỗng"],
    ["20h30", "22:30", "sai định dạng"],
  ])("từ chối %s–%s (%s)", async (start, end) => {
    const id = await makeSession("voting");
    const r = await setSessionTime(id, start, end);
    expect(r).toHaveProperty("error");
    expect(await readTime(id)).toBe("20:30–22:30");
  });

  it("hai giờ trùng nhau: từ chối, vì chắc chắn là gõ nhầm", async () => {
    const id = await makeSession("voting");
    const r = await setSessionTime(id, "20:30", "20:30");
    expect(r).toHaveProperty("error");
    expect(await readTime(id)).toBe("20:30–22:30");
  });

  it("id không hợp lệ: từ chối", async () => {
    expect(await setSessionTime(0, "19:00", "21:00")).toHaveProperty("error");
    expect(await setSessionTime(-1, "19:00", "21:00")).toHaveProperty("error");
    expect(await setSessionTime(1.5, "19:00", "21:00")).toHaveProperty("error");
  });
});

describe("không đụng tới thứ khác", () => {
  /**
   * Hạn vote mặc định vốn tính theo `giờ bắt đầu − 4 tiếng`. Nhưng admin có
   * thể đã tự đặt hạn vote bằng tay, nên dời nó theo là đổi một thứ họ không
   * yêu cầu. Hạn vote có nút sửa riêng.
   */
  it("hạn vote giữ nguyên khi đổi giờ chơi", async () => {
    const id = await makeSession("voting");
    await client.execute({
      sql: "UPDATE sessions SET vote_deadline = ? WHERE id = ?",
      args: ["2026-11-06T16:30:00", id],
    });

    await setSessionTime(id, "19:00", "21:00");

    const r = await client.execute({
      sql: "SELECT vote_deadline FROM sessions WHERE id = ?",
      args: [id],
    });
    expect(r.rows[0].vote_deadline).toBe("2026-11-06T16:30:00");
  });

  it("giá sân và trạng thái giữ nguyên", async () => {
    const id = await makeSession("confirmed");
    await setSessionTime(id, "19:00", "21:00");
    const r = await client.execute({
      sql: "SELECT status, court_price FROM sessions WHERE id = ?",
      args: [id],
    });
    expect(r.rows[0].status).toBe("confirmed");
    expect(r.rows[0].court_price).toBe(200000);
  });
});
