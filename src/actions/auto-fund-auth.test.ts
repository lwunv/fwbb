/**
 * Security tests cho auto-fund actions.
 *
 * `claimFundContribution` cũ đã chấp nhận `memberId` từ client → bất kỳ ai
 * cũng có thể tạo pending claim đứng tên người khác, sau đó chờ admin confirm
 * để rút quỹ giả. Audit phát hiện đây là lỗ hổng critical.
 *
 * Sau fix: action phải lấy memberId từ cookie (`getUserFromCookie`) và bỏ
 * tham số memberId khỏi signature.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, fundMembers, paymentNotifications } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { claimFundContribution } = await import("./auto-fund");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
}

async function seedFundMember(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({ memberId: m.id, isActive: true });
  return m.id;
}

describe("claimFundContribution — authorization", () => {
  beforeEach(async () => {
    await reset();
    userMock.getUserFromCookie.mockReset();
  });

  it("rejects unauthenticated callers (no cookie)", async () => {
    userMock.getUserFromCookie.mockResolvedValue(null);

    const result = await claimFundContribution(500_000);

    expect("error" in result).toBe(true);
    const claims = await testDb.query.paymentNotifications.findMany();
    expect(claims).toHaveLength(0);
  });

  it("uses memberId from the cookie — never trusts a parameter", async () => {
    const victimId = await seedFundMember("Victim", "fb-victim");
    const attackerId = await seedFundMember("Attacker", "fb-attacker");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: attackerId,
      facebookId: "fb-attacker",
    });

    const result = await claimFundContribution(5_000_000);
    expect("error" in result).toBe(false);

    const claims = await testDb.query.paymentNotifications.findMany();
    expect(claims).toHaveLength(1);
    // The memo MUST encode the COOKIE owner (attacker), not the victim
    expect(claims[0].transferContent).toBe(`FWBB QUY ${attackerId}`);
    // And not contain victim's id
    expect(claims[0].transferContent).not.toContain(`QUY ${victimId}`);
  });

  it("rejects amount below 1.000đ", async () => {
    const id = await seedFundMember("M", "fb-m");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      facebookId: "fb-m",
    });
    const tooSmall = await claimFundContribution(500);
    expect("error" in tooSmall).toBe(true);
  });

  it("rejects amount above 100M cap", async () => {
    const id = await seedFundMember("M", "fb-m");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      facebookId: "fb-m",
    });
    const tooBig = await claimFundContribution(200_000_000);
    expect("error" in tooBig).toBe(true);
  });

  it("rejects non-integer / NaN amount", async () => {
    const id = await seedFundMember("M", "fb-m");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      facebookId: "fb-m",
    });
    const float = await claimFundContribution(500_000.5);
    expect("error" in float).toBe(true);
    const nan = await claimFundContribution(Number.NaN);
    expect("error" in nan).toBe(true);
  });

  it("rejects logged-in user not in fund", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "NotInFund", facebookId: "fb-notin" })
      .returning({ id: members.id });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: m.id,
      facebookId: "fb-notin",
    });
    const r = await claimFundContribution(500_000);
    expect("error" in r).toBe(true);
  });

  it("idempotent on replay with same key", async () => {
    const id = await seedFundMember("M", "fb-m");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: id,
      facebookId: "fb-m",
    });
    const key = "uuid-abc-123";
    const first = await claimFundContribution(300_000, key);
    expect("error" in first).toBe(false);

    const second = await claimFundContribution(300_000, key);
    expect("error" in second).toBe(false);
    if ("error" in second) return;
    expect(second.replayed).toBe(true);

    const claims = await testDb.query.paymentNotifications.findMany();
    expect(claims).toHaveLength(1);
  });

  it("memo always encodes the cookie owner even if attacker passes legacy memberId arg", async () => {
    // After hardening, signature should not accept memberId. We verify behavior
    // by checking the memo contains exactly the cookie owner.
    const victimId = await seedFundMember("Victim", "fb-v");
    const meId = await seedFundMember("Me", "fb-me");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: meId,
      facebookId: "fb-me",
    });

    await claimFundContribution(100_000);

    const claims = await testDb.query.paymentNotifications.findMany({
      where: eq(paymentNotifications.transferContent, `FWBB QUY ${meId}`),
    });
    expect(claims).toHaveLength(1);
    const victimClaims = await testDb.query.paymentNotifications.findMany({
      where: eq(paymentNotifications.transferContent, `FWBB QUY ${victimId}`),
    });
    expect(victimClaims).toHaveLength(0);
  });
});
