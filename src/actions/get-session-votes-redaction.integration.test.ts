/**
 * SECURITY: getSessionVotes chạy từ public pages (home, /vote/:id) và trả member
 * vào client component → serialize vào RSC payload gửi xuống MỌI khách vô danh.
 * PHẢI redact mọi field nhạy cảm (secret + PII), KHÔNG chỉ email/bank/fb.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions, votes } from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getSessionVotes } = await import("./votes");

async function reset() {
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

describe("getSessionVotes — redact PII/secret cho public payload", () => {
  beforeEach(reset);

  it("KHÔNG để lộ passwordHash/googleId/phoneNumber/email/bank/fb", async () => {
    const [m] = await testDb
      .insert(members)
      .values({
        name: "Alice",
        facebookId: "fb-secret",
        googleId: "google-sub-secret",
        email: "alice@example.com",
        phoneNumber: "0900000000",
        bankAccountNo: "0123456789",
        passwordHash: "$2a$10$bcrypthashsecret",
      })
      .returning({ id: members.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-06-01", status: "voting" })
      .returning({ id: sessions.id });
    await testDb
      .insert(votes)
      .values({ sessionId: s.id, memberId: m.id, willPlay: true });

    const rows = await getSessionVotes(s.id);
    const mem = rows[0].member as Record<string, unknown>;

    // Secrets/PII phải bị che.
    expect(mem.passwordHash ?? null).toBeNull();
    expect(mem.googleId ?? null).toBeNull();
    expect(mem.phoneNumber ?? null).toBeNull();
    expect(mem.email ?? null).toBeNull();
    expect(mem.bankAccountNo ?? null).toBeNull();
    expect(mem.facebookId ?? "").toBe("");

    // Field hiển thị vẫn giữ.
    expect(mem.name).toBe("Alice");
  });
});
