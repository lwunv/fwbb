/**
 * Security tests cho checkPaymentForMemo / checkPaymentForDebt.
 *
 * Trước fix: action public, ai cũng truyền `memo` để LIKE %memo% qua DB →
 * memo "FWBB" match toàn bộ payment, leak amount/sender content của mọi
 * member. checkPaymentForDebt cũng public.
 *
 * Sau fix: cả hai action yêu cầu cookie user. memo của
 * checkPaymentForMemo phải khớp tiền tố `FWBB QUY <user.memberId>` —
 * server tự build, không tin client. checkPaymentForDebt phải verify
 * debt thuộc về user gọi (hoặc admin).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  paymentNotifications,
  sessionDebts,
  sessions,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const authMock = vi.hoisted(() => ({
  requireAdmin:
    vi.fn<
      () => Promise<
        { admin: { sub: string; role: string } } | { error: string }
      >
    >(),
  getAdminFromCookie: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@/lib/auth", () => authMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { checkPaymentForMemo, checkPaymentForDebt } =
  await import("./payment-status");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
  authMock.requireAdmin.mockReset();
  authMock.getAdminFromCookie.mockReset();
}

async function seedMember(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  return m.id;
}

async function asMember(id: number) {
  userMock.getUserFromCookie.mockResolvedValue({
    memberId: id,
    facebookId: `fb-${id}`,
  });
  authMock.getAdminFromCookie.mockResolvedValue(null);
  authMock.requireAdmin.mockResolvedValue({ error: "no admin" });
}

async function asAdmin() {
  userMock.getUserFromCookie.mockResolvedValue(null);
  authMock.getAdminFromCookie.mockResolvedValue({ sub: "1", role: "admin" });
  authMock.requireAdmin.mockResolvedValue({
    admin: { sub: "1", role: "admin" },
  });
}

async function asAnonymous() {
  userMock.getUserFromCookie.mockResolvedValue(null);
  authMock.getAdminFromCookie.mockResolvedValue(null);
  authMock.requireAdmin.mockResolvedValue({ error: "no admin" });
}

describe("checkPaymentForMemo — auth + memberId binding", () => {
  beforeEach(reset);

  it("rejects unauthenticated callers (no signal)", async () => {
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-1",
      transferContent: "FWBB QUY 1",
      amount: 100_000,
      status: "matched",
    });

    await asAnonymous();
    const r = await checkPaymentForMemo("FWBB");
    expect(r.received).toBe(false);
  });

  it("memo-prefix that doesn't match cookie owner returns no result", async () => {
    const meId = await seedMember("Me", "fb-me");
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-victim",
      transferContent: "FWBB QUY 999",
      amount: 100_000,
      status: "matched",
    });
    await asMember(meId);

    // Try to peek at someone else's payment via crafted memo.
    const r = await checkPaymentForMemo("FWBB QUY 999");
    expect(r.received).toBe(false);
  });

  it("returns own payment when memo matches cookie memberId", async () => {
    const meId = await seedMember("Me", "fb-me");
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-mine",
      transferContent: `FWBB QUY ${meId}`,
      amount: 200_000,
      status: "matched",
      receivedAt: new Date().toISOString(),
    });
    await asMember(meId);

    const r = await checkPaymentForMemo(`FWBB QUY ${meId}`);
    expect(r.received).toBe(true);
    expect(r.amount).toBe(200_000);
  });

  it("very short memo never returns positive (anti-leak guard)", async () => {
    const meId = await seedMember("Me", "fb-me");
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: "g-x",
      transferContent: `FWBB QUY ${meId}`,
      amount: 50_000,
      status: "matched",
    });
    await asMember(meId);
    const r = await checkPaymentForMemo("FW");
    expect(r.received).toBe(false);
  });
});

describe("checkPaymentForDebt — IDOR protection", () => {
  beforeEach(reset);

  async function seedDebt(memberId: number) {
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-04-10", status: "completed", courtPrice: 100_000 })
      .returning({ id: sessions.id });
    const [d] = await testDb
      .insert(sessionDebts)
      .values({
        sessionId: s.id,
        memberId,
        totalAmount: 100_000,
        memberConfirmed: false,
        adminConfirmed: false,
      })
      .returning({ id: sessionDebts.id });
    await testDb.insert(paymentNotifications).values({
      gmailMessageId: `g-${d.id}`,
      transferContent: `FWBB NO ${memberId}`,
      amount: 100_000,
      matchedDebtId: d.id,
      status: "matched",
    });
    return d.id;
  }

  it("rejects unauthenticated callers", async () => {
    const meId = await seedMember("Me", "fb-me");
    const debtId = await seedDebt(meId);
    await asAnonymous();
    const r = await checkPaymentForDebt(debtId);
    expect(r.received).toBe(false);
  });

  it("rejects member querying someone else's debt", async () => {
    const aliceId = await seedMember("Alice", "fb-a");
    const bobId = await seedMember("Bob", "fb-b");
    const aliceDebt = await seedDebt(aliceId);
    await asMember(bobId);
    const r = await checkPaymentForDebt(aliceDebt);
    expect(r.received).toBe(false);
  });

  it("allows owner", async () => {
    const meId = await seedMember("Me", "fb-me");
    const debtId = await seedDebt(meId);
    await asMember(meId);
    const r = await checkPaymentForDebt(debtId);
    expect(r.received).toBe(true);
  });

  it("allows admin", async () => {
    const meId = await seedMember("Me", "fb-me");
    const debtId = await seedDebt(meId);
    await asAdmin();
    const r = await checkPaymentForDebt(debtId);
    expect(r.received).toBe(true);
  });
});
