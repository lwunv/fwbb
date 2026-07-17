import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, sessionAttendees } from "@/db/schema";

// Cố định "hôm nay" để mốc tháng/năm + missedSessions tất định, giữ nguyên các
// export khác của date-format (ymdInVNAddDays, formatSessionDate...) cho an toàn.
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
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

async function mkSession(date: string, status: "voting" | "completed") {
  const [s] = await testDb
    .insert(sessions)
    .values({ date, status })
    .returning({ id: sessions.id });
  return s.id;
}

describe("getMemberPlayStats", () => {
  beforeEach(reset);

  it("đếm buổi tháng/năm theo attendsPlay, lấy lastPlayed + missedSessions, loại guest & voting", async () => {
    const [m1] = await testDb
      .insert(members)
      .values({ name: "Cún" })
      .returning({ id: members.id });
    const [m2] = await testDb
      .insert(members)
      .values({ name: "Mèo" }) // chưa từng chơi → không có entry
      .returning({ id: members.id });

    // Hôm nay = 2026-07-17. monthPrefix=2026-07, yearPrefix=2026.
    const sJul1 = await mkSession("2026-07-05", "completed"); // tháng+năm
    const sJul2 = await mkSession("2026-07-12", "completed"); // tháng+năm, lần chơi cuối
    const sDine = await mkSession("2026-07-14", "completed"); // completed nhưng m1 chỉ nhậu
    const sJun = await mkSession("2026-06-20", "completed"); // năm nay, khác tháng
    const s2025 = await mkSession("2025-11-10", "completed"); // năm trước
    const sVote = await mkSession("2026-07-15", "voting"); // chưa chốt → loại hết

    await testDb.insert(sessionAttendees).values([
      { sessionId: sJul1, memberId: m1.id, attendsPlay: true },
      { sessionId: sJul2, memberId: m1.id, attendsPlay: true },
      {
        sessionId: sDine,
        memberId: m1.id,
        attendsPlay: false,
        attendsDine: true,
      },
      { sessionId: sJun, memberId: m1.id, attendsPlay: true },
      { sessionId: s2025, memberId: m1.id, attendsPlay: true },
      // Guest chơi ở buổi tháng này → KHÔNG được tính cho ai
      {
        sessionId: sJul1,
        memberId: null,
        guestName: "Khách",
        isGuest: true,
        attendsPlay: true,
      },
      // Buổi voting m1 có attendsPlay nhưng phải bị loại (chưa completed)
      { sessionId: sVote, memberId: m1.id, attendsPlay: true },
      // m2 chỉ nhậu, chưa từng chơi
      {
        sessionId: sJun,
        memberId: m2.id,
        attendsPlay: false,
        attendsDine: true,
      },
    ]);

    const stats = await getMemberPlayStats();

    expect(stats[m1.id]).toEqual({
      monthPlay: 2, // sJul1 + sJul2 (sDine attendsPlay=false, sVote chưa completed)
      yearPlay: 3, // + sJun (s2025 là năm trước)
      lastPlayedDate: "2026-07-12", // sJul2, KHÔNG lấy sVote (voting)
      missedSessions: 1, // completed sau 07-12 = chỉ sDine (07-14); voting 07-15 loại
    });

    // m2 chưa từng chơi → không có trong map (component tự coi là "chưa từng đi").
    expect(stats[m2.id]).toBeUndefined();
  });

  it("từ chối khi không phải admin", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAdminFromCookie).mockResolvedValueOnce(null);
    const stats = await getMemberPlayStats();
    expect(stats).toEqual({});
  });
});
