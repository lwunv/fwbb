import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  courts,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMemberPlayHistory } = await import("./member-history");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM members");
}

describe("getMemberPlayHistory", () => {
  beforeEach(reset);

  it("chỉ trả buổi completed, sort date desc, FIFO status theo balance", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Cún" })
      .returning({ id: members.id });
    const [court] = await testDb
      .insert(courts)
      .values({ name: "THCS Tây Mỗ 3", pricePerSession: 420000 })
      .returning({ id: courts.id });
    const mkSession = async (date: string, status: string) => {
      const [s] = await testDb
        .insert(sessions)
        .values({ date, status, courtId: court.id })
        .returning({ id: sessions.id });
      return s.id;
    };
    const s1 = await mkSession("2026-06-22", "completed");
    const s2 = await mkSession("2026-06-24", "completed");
    const sVoting = await mkSession("2026-06-29", "voting"); // phải bị loại
    await testDb.insert(sessionDebts).values([
      { sessionId: s1, memberId: m.id, totalAmount: 40000, playAmount: 40000 },
      { sessionId: s2, memberId: m.id, totalAmount: 50000, playAmount: 50000 },
      {
        sessionId: sVoting,
        memberId: m.id,
        totalAmount: 60000,
        playAmount: 60000,
      },
    ]);
    // Nạp 70K, bị trừ 90K (2 buổi completed) → balance -20K → buổi mới nhất partial
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_contribution",
        direction: "in",
        amount: 70000,
        memberId: m.id,
        description: "nạp",
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 40000,
        memberId: m.id,
        description: "buổi 22/6",
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 50000,
        memberId: m.id,
        description: "buổi 24/6",
      },
    ]);

    const res = await getMemberPlayHistory(m.id);
    if ("error" in res) throw new Error(res.error);
    expect(res.balance).toBe(-20000);
    expect(res.entries.map((e) => e.sessionId)).toEqual([s2, s1]); // desc
    expect(res.entries[0].paidStatus).toBe("partial");
    expect(res.entries[1].paidStatus).toBe("paid");
    expect(res.entries[0].courtName).toBe("THCS Tây Mỗ 3");
    expect(res.entries[0].playAmount).toBe(50000);
  });

  it("member không có buổi nào → entries rỗng, vẫn có balance", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Mới" })
      .returning({ id: members.id });
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_contribution",
        direction: "in",
        amount: 100000,
        memberId: m.id,
        description: "nạp",
      },
    ]);
    const res = await getMemberPlayHistory(m.id);
    if ("error" in res) throw new Error(res.error);
    expect(res.entries).toEqual([]);
    expect(res.balance).toBe(100000);
  });

  it("memberId không hợp lệ → error, không throw", async () => {
    const res = await getMemberPlayHistory(-1);
    expect("error" in res).toBe(true);
  });
});
