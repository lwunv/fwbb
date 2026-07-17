import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, sessionAttendees, votes } from "@/db/schema";

// Cố định "hôm nay" để mốc tháng/năm tất định.
vi.mock("@/lib/date-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-format")>()),
  ymdInVN: () => "2026-07-17",
}));
vi.mock("@/lib/auth", () => ({
  getAdminFromCookie: vi.fn(async () => ({ role: "admin" })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMemberPlayStats } = await import("./stats");

async function reset() {
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

async function mkSession(
  date: string,
  status: "voting" | "confirmed" | "completed" | "cancelled",
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status })
    .returning({ id: sessions.id });
  return s.id;
}

describe("getMemberPlayStats", () => {
  beforeEach(reset);

  it("tính CẢ buổi chưa chốt sổ (votes.willPlay); completed dùng attendees; bỏ future/cancelled/guest", async () => {
    const [m1] = await testDb
      .insert(members)
      .values({ name: "Cún" })
      .returning({ id: members.id });
    const [m2] = await testDb
      .insert(members)
      .values({ name: "Mèo" }) // không chơi buổi nào → không có entry
      .returning({ id: members.id });

    // Hôm nay = 2026-07-17. monthPrefix=2026-07, yearPrefix=2026.
    const sC1 = await mkSession("2026-07-05", "completed"); // tháng+năm (attendees)
    const sC2 = await mkSession("2026-06-20", "completed"); // năm (attendees)
    const s2025 = await mkSession("2025-11-10", "completed"); // năm trước
    const sConfirmed = await mkSession("2026-07-14", "confirmed"); // CHƯA chốt → votes
    const sVoting = await mkSession("2026-07-16", "voting"); // CHƯA chốt → votes (lần cuối)
    const sFuture = await mkSession("2026-07-20", "confirmed"); // tương lai → loại
    const sCancelled = await mkSession("2026-07-10", "cancelled"); // huỷ → loại
    const sC3 = await mkSession("2026-07-13", "completed"); // completed nhưng m1 KHÔNG chơi

    // Attendees (chỉ buổi completed mới có).
    await testDb.insert(sessionAttendees).values([
      { sessionId: sC1, memberId: m1.id, attendsPlay: true },
      { sessionId: sC2, memberId: m1.id, attendsPlay: true },
      { sessionId: s2025, memberId: m1.id, attendsPlay: true },
      // Guest chơi buổi completed → không tính cho ai.
      {
        sessionId: sC1,
        memberId: null,
        guestName: "Khách",
        isGuest: true,
        attendsPlay: true,
      },
      // Buổi completed nhưng admin đã bỏ m1 khỏi đội hình (attendsPlay=false).
      { sessionId: sC3, memberId: m1.id, attendsPlay: false },
    ]);

    // Votes: buổi chưa chốt lấy từ đây; buổi completed KHÔNG lấy từ votes.
    await testDb.insert(votes).values([
      { sessionId: sConfirmed, memberId: m1.id, willPlay: true },
      { sessionId: sVoting, memberId: m1.id, willPlay: true },
      { sessionId: sFuture, memberId: m1.id, willPlay: true }, // tương lai → loại
      { sessionId: sCancelled, memberId: m1.id, willPlay: true }, // huỷ → loại
      // m1 vote willPlay ở buổi completed sC3, nhưng attendees.attendsPlay=false
      // là nguồn chuẩn → sC3 KHÔNG được tính cho m1.
      { sessionId: sC3, memberId: m1.id, willPlay: true },
      // m2 chỉ vote KHÔNG chơi.
      { sessionId: sVoting, memberId: m2.id, willPlay: false },
    ]);

    const stats = await getMemberPlayStats();

    expect(stats[m1.id]).toEqual({
      // tháng 2026-07: sC1(05) + sConfirmed(14) + sVoting(16) = 3
      monthPlay: 3,
      // năm 2026: + sC2(06-20) = 4 (s2025 là năm trước; sC3 attendsPlay=false)
      yearPlay: 4,
      // lần cuối = sVoting 2026-07-16 (buổi chưa chốt vẫn tính)
      lastPlayedDate: "2026-07-16",
    });
    expect(stats[m2.id]).toBeUndefined();
  });

  it("từ chối khi không phải admin", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAdminFromCookie).mockResolvedValueOnce(null);
    const stats = await getMemberPlayStats();
    expect(stats).toEqual({});
  });
});
