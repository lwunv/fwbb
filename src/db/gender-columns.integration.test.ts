/**
 * Migration 0024 thêm sáu cột cho chặng giới tính. Test này đọc/ghi từng cột
 * qua DB thật dựng từ schema.
 *
 * Nó rẻ nhưng bắt được đúng một lớp lỗi mà test hàm thuần không thấy: tên cột
 * trong `schema.ts` lệch với tên trong file `.sql`. Lệch kiểu đó biên dịch vẫn
 * qua, chỉ nổ lúc chạy thật, và nổ trên đường chốt sổ thì là nổ vào tiền.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes, sessionAttendees } from "@/db/schema";
import { eq } from "drizzle-orm";

const { db: testDb, client } = await createTestDb();

beforeEach(async () => {
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
});

describe("cột giới tính (migration 0024)", () => {
  it("members.gender ghi rồi đọc lại đúng, và mặc định là null", async () => {
    const [nu] = await testDb
      .insert(members)
      .values({ name: "Nữ", gender: "female" })
      .returning();
    const [chuaKhai] = await testDb
      .insert(members)
      .values({ name: "Chưa khai" })
      .returning();

    expect(nu.gender).toBe("female");
    // Chưa khai phải là null chứ không phải "male": cost-calculator TỰ quy ước
    // null là không-nữ, còn DB không được đoán hộ.
    expect(chuaKhai.gender).toBeNull();

    const doclai = await testDb.query.members.findFirst({
      where: eq(members.id, nu.id),
    });
    expect(doclai?.gender).toBe("female");
  });

  it("votes giữ được số khách nữ, mặc định 0", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Người vote" })
      .returning();
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-09-21" })
      .returning();

    const [v] = await testDb
      .insert(votes)
      .values({
        sessionId: s.id,
        memberId: m.id,
        guestPlayCount: 3,
        guestPlayFemaleCount: 2,
      })
      .returning();

    expect(v.guestPlayCount).toBe(3);
    expect(v.guestPlayFemaleCount).toBe(2);
    // Không khai thì là 0, không phải null — hai cột đếm này luôn cộng được.
    expect(v.guestDineFemaleCount).toBe(0);
  });

  it("sessions giữ được số khách nữ của admin, mặc định 0", async () => {
    const [s] = await testDb
      .insert(sessions)
      .values({
        date: "2026-09-21",
        adminGuestPlayCount: 4,
        adminGuestPlayFemaleCount: 1,
      })
      .returning();

    expect(s.adminGuestPlayFemaleCount).toBe(1);
    expect(s.adminGuestDineFemaleCount).toBe(0);
  });

  it("session_attendees chốt được giới tính của từng đầu người", async () => {
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-09-21" })
      .returning();

    const [khachNu] = await testDb
      .insert(sessionAttendees)
      .values({
        sessionId: s.id,
        guestName: "Khách nữ 1",
        isGuest: true,
        attendsPlay: true,
        gender: "female",
      })
      .returning();
    const [khachKhongKhai] = await testDb
      .insert(sessionAttendees)
      .values({
        sessionId: s.id,
        guestName: "Khách 2",
        isGuest: true,
        attendsPlay: true,
      })
      .returning();

    expect(khachNu.gender).toBe("female");
    expect(khachKhongKhai.gender).toBeNull();
  });
});
