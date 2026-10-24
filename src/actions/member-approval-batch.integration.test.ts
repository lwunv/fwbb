/**
 * Gợi ý trùng tên cho nhiều người chờ duyệt cùng lúc.
 *
 * Bài đáng giá nhất ở đây là bài ĐẾM TRUY VẤN. Bản cũ gọi `getNameMatches`
 * trong vòng lặp, mỗi lần lại nạp nguyên danh sách member đã duyệt: 182 người
 * chờ duyệt là hơn 360 truy vấn và 8.000 dòng đọc cho MỘT lần mở trang, mà màn
 * đó còn tự làm mới theo nhịp. Đó là thứ làm cháy hạn mức đọc của Turso ngày
 * 24/10/2026 và sập cả web. Kết quả đúng thôi chưa đủ; số lần đọc mới là thứ
 * phải khoá lại.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

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

const { getNameMatches, getNameMatchesBatch } =
  await import("./member-approval");

/** Đếm số câu truy vấn chạy trong một đoạn code. */
async function countQueries<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const orig = client.execute.bind(client);
  let n = 0;
  // Thay tạm để đếm, trả lại ngay sau khi chạy xong.
  client.execute = (...args: unknown[]) => {
    n += 1;
    // @ts-expect-error - chuyển tiếp nguyên tham số
    return orig(...args);
  };
  try {
    return [await fn(), n];
  } finally {
    client.execute = orig;
  }
}

let pendingIds: number[] = [];

beforeEach(async () => {
  await client.execute("DELETE FROM members");

  // 20 người đã duyệt làm pool, trong đó vài người trùng tên với pending.
  const approved = [];
  for (let i = 0; i < 20; i++) {
    approved.push({
      name: i === 0 ? "Nguyễn Văn A" : `Người ${i}`,
      approvalStatus: "approved" as const,
    });
  }
  await testDb.insert(members).values(approved);

  const rows = await testDb
    .insert(members)
    .values([
      { name: "Nguyễn Văn A", approvalStatus: "pending" as const },
      { name: "Người 5", approvalStatus: "pending" as const },
      { name: "Không giống ai cả xyz", approvalStatus: "pending" as const },
    ])
    .returning({ id: members.id });
  pendingIds = rows.map((r) => r.id);
});

describe("gợi ý trùng tên theo lô", () => {
  it("cho ra ĐÚNG kết quả như gọi lẻ từng người", async () => {
    const batch = await getNameMatchesBatch(pendingIds);

    for (const id of pendingIds) {
      const one = await getNameMatches(id);
      expect(batch[id], `pending ${id}`).toEqual(one);
    }
  });

  it("tìm đúng người trùng tên", async () => {
    const batch = await getNameMatchesBatch(pendingIds);
    expect(batch[pendingIds[0]][0].name).toBe("Nguyễn Văn A");
    expect(batch[pendingIds[1]][0].name).toBe("Người 5");
    expect(batch[pendingIds[2]]).toEqual([]);
  });

  it("SỐ TRUY VẤN KHÔNG tăng theo số người chờ duyệt", async () => {
    const [, few] = await countQueries(() =>
      getNameMatchesBatch(pendingIds.slice(0, 1)),
    );
    const [, many] = await countQueries(() => getNameMatchesBatch(pendingIds));

    // Một người hay ba người cũng chừng ấy truy vấn. Vòng lặp quay lại là con
    // số này nhảy theo số người và bài đỏ.
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(3);
  });

  it("danh sách rỗng thì không đọc gì cả", async () => {
    const [res, n] = await countQueries(() => getNameMatchesBatch([]));
    expect(res).toEqual({});
    expect(n).toBe(0);
  });
});
