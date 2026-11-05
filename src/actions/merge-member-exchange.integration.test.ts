/**
 * Gộp và xoá member khi có dữ liệu giao lưu. FK bật thật, nên mergeMember,
 * duyệt kiểu gộp và deleteMember phải xử lý 4 bảng giao lưu.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  abuseReports,
  admins as adminsTable,
  exchangeEvents,
  exchangeRegistrations,
  financialTransactions,
  hostBlocks,
  members,
  sessionDebts,
  sessions,
  venues,
  votes,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { computeBalanceFromTransactions } from "@/lib/fund-core";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => true),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { mergeMember, deleteMember } = await import("./members");
const { approveAndMergeMember } = await import("./member-approval");

const NOW = "2026-11-05T00:00:00.000Z";

async function reset() {
  for (const t of [
    "abuse_reports",
    "host_blocks",
    "exchange_registrations",
    "exchange_events",
    "venues",
    "financial_transactions",
    "session_debts",
    "session_attendees",
    "votes",
    "sessions",
    "admins",
    "member_oauth_identities",
    "members",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

async function mk(
  name: string,
  extra: Partial<typeof members.$inferInsert> = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({ name, approvalStatus: "approved", ...extra })
    .returning({ id: members.id });
  return m.id;
}

let venueId = 0;
async function mkEvent(hostId: number, code: string) {
  if (!venueId) {
    const [v] = await testDb
      .insert(venues)
      .values({ name: "V", lat: 10, lng: 106 })
      .returning({ id: venues.id });
    venueId = v.id;
  }
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: code,
      hostMemberId: hostId,
      venueId,
      title: "Giao lưu",
      startAt: "2026-12-01T12:00:00.000Z",
      endAt: "2026-12-01T14:00:00.000Z",
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: "2026-12-01T10:00:00.000Z",
      cancelDeadline: "2026-12-01T08:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeEvents.id });
  return e.id;
}

async function mkReg(eventId: number, memberId: number, status = "approved") {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status: status as "approved",
      maleCount: 1,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeRegistrations.id });
  return r.id;
}

describe("exchange rows through merge and delete", () => {
  beforeEach(async () => {
    await reset();
    venueId = 0;
    const adminMember = await mk("Admin");
    const [a] = await testDb
      .insert(adminsTable)
      .values({ username: "Admin", passwordHash: "x", memberId: adminMember })
      .returning({ id: adminsTable.id });
    const { requireAdmin } = await import("@/lib/auth");
    vi.mocked(requireAdmin).mockResolvedValue({
      admin: { sub: String(a.id), role: "admin" },
    } as never);
  });

  it("mergeMember with exchange registrations, a hosted event, blocks and reports moves them to the target", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    const other = await mk("Khac");
    const hosted = await mkEvent(source, "AAA");
    const otherEvent = await mkEvent(other, "BBB");
    const regId = await mkReg(otherEvent, source);
    await testDb.insert(hostBlocks).values([
      { hostMemberId: source, blockedMemberId: other, createdAt: NOW },
      { hostMemberId: other, blockedMemberId: source, createdAt: NOW },
    ]);
    await testDb.insert(abuseReports).values([
      {
        reporterMemberId: source,
        targetType: "event",
        targetId: otherEvent,
        reason: "spam",
        createdAt: NOW,
      },
      {
        reporterMemberId: other,
        targetType: "member",
        targetId: source,
        reason: "abusive",
        createdAt: NOW,
      },
    ]);

    const r = await mergeMember(source, target);
    expect(r).toEqual({ success: true });

    const ev = await testDb.query.exchangeEvents.findFirst({
      where: eq(exchangeEvents.id, hosted),
    });
    expect(ev?.hostMemberId).toBe(target);
    const reg = await testDb.query.exchangeRegistrations.findFirst({
      where: eq(exchangeRegistrations.id, regId),
    });
    expect(reg?.memberId).toBe(target);
    expect(reg?.status).toBe("approved");
    const blocks = await testDb.select().from(hostBlocks);
    expect(
      blocks.map((b) => `${b.hostMemberId}:${b.blockedMemberId}`).sort(),
    ).toEqual([`${target}:${other}`, `${other}:${target}`].sort());
    const reports = await testDb.select().from(abuseReports);
    expect(reports).toHaveLength(2);
    expect(
      reports.find((x) => x.targetType === "event")?.reporterMemberId,
    ).toBe(target);
    expect(reports.find((x) => x.targetType === "member")?.targetId).toBe(
      target,
    );
    expect(
      await testDb.query.members.findFirst({ where: eq(members.id, source) }),
    ).toBeUndefined();
  });

  it("merge keeps the target's registration when both registered for the same event", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    const host = await mk("Host");
    const ev = await mkEvent(host, "CCC");
    await mkReg(ev, source, "pending");
    const targetReg = await mkReg(ev, target, "approved");
    // Cặp chặn và báo cáo trùng cũng giữ dòng của đích.
    await testDb.insert(hostBlocks).values([
      { hostMemberId: host, blockedMemberId: source, createdAt: NOW },
      { hostMemberId: host, blockedMemberId: target, createdAt: NOW },
      { hostMemberId: source, blockedMemberId: target, createdAt: NOW },
    ]);
    await testDb.insert(abuseReports).values([
      {
        reporterMemberId: source,
        targetType: "event",
        targetId: ev,
        reason: "spam",
        createdAt: NOW,
      },
      {
        reporterMemberId: target,
        targetType: "event",
        targetId: ev,
        reason: "other",
        createdAt: NOW,
      },
    ]);

    expect(await mergeMember(source, target)).toEqual({ success: true });

    const regs = await testDb
      .select()
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.eventId, ev));
    expect(regs).toHaveLength(1);
    expect(regs[0].id).toBe(targetReg);
    expect(regs[0].status).toBe("approved");
    // host->target giữ lại, host->source trùng nên xoá, source->target thành
    // target->target (tự chặn mình) nên xoá.
    const blocks = await testDb.select().from(hostBlocks);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hostMemberId).toBe(host);
    expect(blocks[0].blockedMemberId).toBe(target);
    const reports = await testDb.select().from(abuseReports);
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe("other");
  });

  it("merge cancels the source's registration to an event the target hosts", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    const ev = await mkEvent(target, "DDD");
    const regId = await mkReg(ev, source, "approved");

    expect(await mergeMember(source, target)).toEqual({ success: true });

    const reg = await testDb.query.exchangeRegistrations.findFirst({
      where: eq(exchangeRegistrations.id, regId),
    });
    expect(reg?.memberId).toBe(target);
    expect(reg?.status).toBe("cancelled");
    expect(reg?.cancelledAt).toBeTruthy();
  });

  it("merge conflict carries the source's exchange money onto the kept target row (R24)", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    const host = await mk("Host");
    const setMoney = (
      id: number,
      v: Partial<typeof exchangeRegistrations.$inferInsert>,
    ) =>
      testDb
        .update(exchangeRegistrations)
        .set(v)
        .where(eq(exchangeRegistrations.id, id));

    // Both paid: amounts add up, earliest timestamps win.
    const both = await mkEvent(host, "GGG");
    const s1 = await mkReg(both, source, "approved");
    const t1 = await mkReg(both, target, "approved");
    await setMoney(s1, {
      depositPaid: true,
      depositPaidAt: "2026-11-01T00:00:00.000Z",
      paid: true,
      paidAmount: 50_000,
      paidAt: "2026-11-03T00:00:00.000Z",
    });
    await setMoney(t1, {
      paid: true,
      paidAmount: 30_000,
      paidAt: "2026-11-02T00:00:00.000Z",
    });

    // Only the source paid a deposit: the target row inherits it.
    const depOnly = await mkEvent(host, "HHH");
    const s2 = await mkReg(depOnly, source, "pending");
    const t2 = await mkReg(depOnly, target, "pending");
    await setMoney(s2, {
      depositPaid: true,
      depositPaidAt: "2026-11-04T00:00:00.000Z",
    });

    // Only the source paid in full.
    const srcPaid = await mkEvent(host, "III");
    const s3 = await mkReg(srcPaid, source, "approved");
    const t3 = await mkReg(srcPaid, target, "approved");
    await setMoney(s3, {
      paid: true,
      paidAmount: 80_000,
      paidAt: "2026-11-04T00:00:00.000Z",
    });

    expect(await mergeMember(source, target)).toEqual({ success: true });

    const row = async (id: number) =>
      (
        await testDb
          .select()
          .from(exchangeRegistrations)
          .where(eq(exchangeRegistrations.id, id))
      )[0];
    for (const id of [s1, s2, s3]) expect(await row(id)).toBeUndefined();
    expect(await row(t1)).toMatchObject({
      memberId: target,
      depositPaid: true,
      depositPaidAt: "2026-11-01T00:00:00.000Z",
      paid: true,
      paidAmount: 80_000,
      paidAt: "2026-11-02T00:00:00.000Z",
    });
    expect(await row(t2)).toMatchObject({
      depositPaid: true,
      depositPaidAt: "2026-11-04T00:00:00.000Z",
      paid: false,
      paidAmount: null,
    });
    expect(await row(t3)).toMatchObject({
      paid: true,
      paidAmount: 80_000,
      paidAt: "2026-11-04T00:00:00.000Z",
    });
  });

  it("merge cancels the target's registration to an event the source hosted", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    const ev = await mkEvent(source, "JJJ");
    const regId = await mkReg(ev, target, "approved");

    expect(await mergeMember(source, target)).toEqual({ success: true });

    const reg = await testDb.query.exchangeRegistrations.findFirst({
      where: eq(exchangeRegistrations.id, regId),
    });
    const event = await testDb.query.exchangeEvents.findFirst({
      where: eq(exchangeEvents.id, ev),
    });
    expect(event?.hostMemberId).toBe(target);
    expect(reg?.memberId).toBe(target);
    expect(reg?.status).toBe("cancelled");
    expect(reg?.cancelledAt).toBeTruthy();
  });

  it("approve-as-merge of a pending exchange account with a registration succeeds", async () => {
    const target = await mk("Dich");
    const pending = await mk("Cho duyet", {
      approvalStatus: "pending",
      googleId: "g-pend",
    });
    const host = await mk("Host");
    const ev = await mkEvent(host, "EEE");
    const regId = await mkReg(ev, pending, "pending");
    await testDb.insert(hostBlocks).values({
      hostMemberId: host,
      blockedMemberId: pending,
      createdAt: NOW,
    });

    const r = await approveAndMergeMember(pending, target);
    expect(r).toEqual({ success: true });

    const reg = await testDb.query.exchangeRegistrations.findFirst({
      where: eq(exchangeRegistrations.id, regId),
    });
    expect(reg?.memberId).toBe(target);
    const [b] = await testDb.select().from(hostBlocks);
    expect(b.blockedMemberId).toBe(target);
    expect(
      await testDb.query.members.findFirst({ where: eq(members.id, pending) }),
    ).toBeUndefined();
  });

  it("deleteMember with exchange rows returns the friendly ref error and deletes nothing", async () => {
    const m = await mk("Co giao luu");
    await mkEvent(m, "FFF");

    const r = await deleteMember(m);
    expect(r).toHaveProperty("error");
    expect(
      await testDb.query.members.findFirst({ where: eq(members.id, m) }),
    ).toBeDefined();
    expect(await testDb.select().from(exchangeEvents)).toHaveLength(1);
  });

  it("merge of members with no exchange rows behaves as before", async () => {
    const source = await mk("Nguon");
    const target = await mk("Dich");
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 50_000,
      memberId: source,
    });
    await testDb.insert(financialTransactions).values({
      type: "fund_contribution",
      direction: "in",
      amount: 20_000,
      memberId: target,
    });
    const [s] = await testDb
      .insert(sessions)
      .values({ date: "2026-10-01", status: "voting" })
      .returning({ id: sessions.id });
    await testDb
      .insert(votes)
      .values({ sessionId: s.id, memberId: source, willPlay: true });
    await testDb.insert(sessionDebts).values({
      sessionId: s.id,
      memberId: source,
      playAmount: 30_000,
      dineAmount: 0,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      totalAmount: 30_000,
    });

    expect(await mergeMember(source, target)).toEqual({ success: true });

    const txs = await testDb.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, target),
    });
    expect(computeBalanceFromTransactions(target, txs).balance).toBe(70_000);
    const v = await testDb.query.votes.findFirst({
      where: and(eq(votes.sessionId, s.id), eq(votes.memberId, target)),
    });
    expect(v).toBeDefined();
    const d = await testDb.query.sessionDebts.findFirst({
      where: eq(sessionDebts.memberId, target),
    });
    expect(d?.totalAmount).toBe(30_000);
  });
});
