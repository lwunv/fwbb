import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  financialTransactions,
  members,
  sessionDebts,
  sessions,
} from "@/db/schema";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
}));
vi.mock("@/lib/notifications/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications/notify")>()),
  isNotificationsEnabled: vi.fn(async () => {
    throw new Error("settings read failed");
  }),
}));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("@/actions/finance");

describe("finalizeSession when the notification switch cannot be read", () => {
  it("returns { error } and writes nothing", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "A", facebookId: "fb-a" })
      .returning({ id: members.id });
    await testDb
      .insert(admins)
      .values({ id: 1, username: "adm", passwordHash: "x", memberId: m.id });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-11-10", status: "confirmed", courtPrice: 300_000 })
      .returning({ id: sessions.id });

    const r = await finalizeSession(
      s.id,
      [
        {
          memberId: m.id,
          guestName: null,
          invitedById: null,
          isGuest: false,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );

    expect(r).toHaveProperty("error");
    expect((r as { error: string }).error).toContain("Không chốt được buổi");
    expect(await testDb.select().from(sessionDebts)).toHaveLength(0);
    expect(await testDb.select().from(financialTransactions)).toHaveLength(0);
    const after = await testDb.query.sessions.findFirst();
    expect(after?.status).toBe("confirmed");
  });
});
