import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  financialTransactions,
  members,
  notifications,
  paymentNotifications,
  sessionDebts,
  sessions,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; facebookId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
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

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  finalizeSession,
  confirmPaymentByMember,
  confirmPaymentByAdmin,
  undoPaymentByAdmin,
} = await import("@/actions/finance");
const {
  recordContribution,
  recordRefund,
  reverseFinancialTransaction,
  confirmFundClaim,
} = await import("@/actions/fund");
const { claimFundContribution } = await import("@/actions/auto-fund");
const { deleteSession, unlockSession, cancelSession } =
  await import("@/actions/sessions");
const { processPayment } = await import("@/lib/payment-matcher");
const { getFundBalance } = await import("@/lib/fund-calculator");
const { enableNotificationsForTest } = await import("./test-helpers");
const { requireAdmin } = await import("@/lib/auth");

async function reset() {
  await client.execute("DROP TRIGGER IF EXISTS fail_notification_insert");
  for (const t of [
    "notifications",
    "notification_prefs",
    "payment_notifications",
    "financial_transactions",
    "session_min_deduction_exemptions",
    "session_debts",
    "session_attendees",
    "session_shuttlecocks",
    "votes",
    "sessions",
    "admins",
    "members",
    "app_settings",
    "rate_limits",
  ]) {
    await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
  }
  userMock.getUserFromCookie.mockReset();
}

let seq = 0;
async function addMember(name?: string) {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({
      name: name ?? `M${seq}`,
      facebookId: `fb-${seq}`,
      bankAccountNo: `acct-${seq}`,
    })
    .returning({ id: members.id });
  return m.id;
}

/** Admin (superadmin) gắn với một member; requireAdmin trỏ vào admin này. */
async function linkAdmin() {
  const memberId = await addMember("Chau");
  const [a] = await testDb
    .insert(admins)
    .values({ username: `admin${seq}`, passwordHash: "x", memberId })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
  return { adminMemberId: memberId, adminId: a.id };
}

async function addSession(values: Partial<typeof sessions.$inferInsert> = {}) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-11-10",
      startTime: "20:30",
      status: "confirmed",
      courtPrice: 300_000,
      useMinDeduction: false,
      ...values,
    })
    .returning({ id: sessions.id });
  return s.id;
}

type Who = { id: number; play?: boolean; dine?: boolean };
const att = (w: Who) => ({
  memberId: w.id,
  guestName: null,
  invitedById: null,
  isGuest: false,
  attendsPlay: w.play ?? true,
  attendsDine: w.dine ?? false,
});

async function finalize(sid: number, who: Who[], diningBill = 0) {
  const r = await finalizeSession(sid, who.map(att), diningBill);
  expect(r).toHaveProperty("success", true);
}

async function notes(kind?: string) {
  const all = await testDb
    .select({
      recipientType: notifications.recipientType,
      recipientId: notifications.recipientId,
      kind: notifications.kind,
      payload: notifications.payload,
      dedupKey: notifications.dedupKey,
    })
    .from(notifications)
    .orderBy(asc(notifications.id));
  return kind ? all.filter((r) => r.kind === kind) : all;
}

async function debtOf(sid: number, memberId: number) {
  const d = await testDb.query.sessionDebts.findFirst({
    where: and(
      eq(sessionDebts.sessionId, sid),
      eq(sessionDebts.memberId, memberId),
    ),
  });
  if (!d) throw new Error("debt missing");
  return d;
}

const balanceOf = async (id: number) => (await getFundBalance(id)).balance;
const key = () => `k-${Math.random().toString(36).slice(2)}`;

beforeEach(reset);

describe("finalize", () => {
  it("finalize notifies each attendee with their own amounts only", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const [a, b, c] = [await addMember(), await addMember(), await addMember()];
    const sid = await addSession();
    await finalize(
      sid,
      [
        { id: a, play: true, dine: true },
        { id: b, play: true },
        { id: c, play: false, dine: true },
      ],
      100_000,
    );

    const sent = await notes("session_finalized");
    expect(sent.map((n) => n.recipientId).sort()).toEqual([a, b, c].sort());
    for (const n of sent) {
      const d = await debtOf(sid, n.recipientId);
      expect(n.recipientType).toBe("member");
      expect(n.payload).toEqual({
        sessionDate: "2026-11-10",
        startTime: "20:30",
        playAmount: d.playAmount,
        dineAmount: d.dineAmount,
        guestPlayAmount: d.guestPlayAmount,
        guestDineAmount: d.guestDineAmount,
        guestToFund: 0,
        total: d.totalAmount,
        balance: await balanceOf(n.recipientId),
      });
      expect(n.dedupKey).toBe(`fin:s${sid}:n0:m${n.recipientId}`);
    }
    // Ba người có ba tổng khác nhau: không tin nào lộ tổng của người khác.
    const totals = sent.map((n) => (n.payload as { total: number }).total);
    expect(new Set(totals).size).toBe(3);
  });

  it("re-finalize with same amounts sends nothing; after unlock and edit, changed total sends session_amount_changed with old and new totals", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const [a, b, c] = [await addMember(), await addMember(), await addMember()];
    const sid = await addSession();
    await finalize(sid, [{ id: a }, { id: b }, { id: c }]);
    expect(await notes()).toHaveLength(3);

    await finalize(sid, [{ id: a }, { id: b }, { id: c }]);
    expect(await notes()).toHaveLength(3);

    const before = (await debtOf(sid, a)).totalAmount;
    expect(await unlockSession(sid)).toHaveProperty("success", true);
    await finalize(
      sid,
      [{ id: a, dine: true }, { id: b, dine: true }, { id: c }],
      60_000,
    );
    const changed = await notes("session_amount_changed");
    expect(changed.map((n) => n.recipientId).sort()).toEqual([a, b].sort());
    for (const n of changed) {
      const d = await debtOf(sid, n.recipientId);
      expect(n.payload).toMatchObject({
        oldTotal: before,
        total: d.totalAmount,
        balance: await balanceOf(n.recipientId),
      });
      expect(d.totalAmount).not.toBe(before);
      expect(n.dedupKey).toBe(`fin:s${sid}:n1:m${n.recipientId}`);
    }
  });

  it("finalize 3 members, unlock, remove 1, re-finalize: the removed member gets one session_amount_changed with newTotal 0", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const [a, b, c] = [await addMember(), await addMember(), await addMember()];
    const sid = await addSession();
    await finalize(sid, [{ id: a }, { id: b }, { id: c }]);
    const old = (await debtOf(sid, c)).totalAmount;

    await unlockSession(sid);
    await finalize(sid, [{ id: a }, { id: b }]);
    // Chốt lại lần nữa không làm người bị bỏ nhận thêm tin.
    await finalize(sid, [{ id: a }, { id: b }]);

    const forC = (await notes("session_amount_changed")).filter(
      (n) => n.recipientId === c,
    );
    expect(forC).toHaveLength(1);
    expect(forC[0].payload).toMatchObject({
      oldTotal: old,
      total: 0,
      balance: await balanceOf(c),
    });
    expect(await balanceOf(c)).toBe(0);
  });

  it("admin member with admin guests: payload total = play + dine, guest amount reported as going to the fund", async () => {
    await enableNotificationsForTest(testDb);
    const { adminMemberId } = await linkAdmin();
    const a = await addMember();
    const sid = await addSession({ adminGuestPlayCount: 1 });
    const r = await finalizeSession(
      sid,
      [
        att({ id: adminMemberId }),
        att({ id: a }),
        {
          memberId: null,
          guestName: "Khach",
          invitedById: adminMemberId,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      0,
    );
    expect(r).toHaveProperty("success", true);

    const d = await debtOf(sid, adminMemberId);
    const guest = (d.guestPlayAmount ?? 0) + (d.guestDineAmount ?? 0);
    expect(guest).toBeGreaterThan(0);
    const [n] = (await notes("session_finalized")).filter(
      (x) => x.recipientId === adminMemberId,
    );
    expect(n.payload).toMatchObject({
      playAmount: d.playAmount,
      dineAmount: d.dineAmount,
      guestPlayAmount: 0,
      guestDineAmount: 0,
      guestToFund: guest,
      total: (d.playAmount ?? 0) + (d.dineAmount ?? 0),
      balance: await balanceOf(adminMemberId),
    });
  });
});

describe("switch off", () => {
  /** Ghi lại SQL (kèm tham số) của kết nối chính lẫn kết nối transaction. */
  function spySql() {
    const stmts: { sql: string; args: unknown[] }[] = [];
    const norm = (stmt: unknown) =>
      typeof stmt === "string"
        ? { sql: stmt, args: [] }
        : {
            sql: (stmt as { sql: string }).sql,
            args: ((stmt as { args?: unknown[] }).args ?? []) as unknown[],
          };
    const exec = vi.spyOn(client, "execute");
    const realTransaction = client.transaction.bind(client);
    const txSpy = vi.spyOn(client, "transaction").mockImplementation((async (
      ...args: Parameters<typeof realTransaction>
    ) => {
      const tx = await realTransaction(...args);
      const realTxExecute = tx.execute.bind(tx);
      tx.execute = ((stmt: never) => {
        stmts.push(norm(stmt));
        return realTxExecute(stmt);
      }) as typeof tx.execute;
      return tx;
    }) as typeof client.transaction);
    return {
      stmts,
      restore() {
        for (const c of exec.mock.calls) stmts.push(norm(c[0]));
        exec.mockRestore();
        txSpy.mockRestore();
      },
    };
  }

  it("switch off: finalizeSession runs no query on notification tables and no extra financial_transactions read", async () => {
    await linkAdmin();
    const [a, b] = [await addMember(), await addMember()];
    const sid = await addSession();
    const spy = spySql();
    try {
      await finalize(sid, [{ id: a }, { id: b }]);
    } finally {
      spy.restore();
    }
    const sqls = spy.stmts.map((s) => s.sql);
    expect(sqls.length).toBeGreaterThan(0);
    // Cột "payment_notification_id" của sổ cái không tính: chỉ bảng thông báo.
    expect(sqls.join("\n")).not.toMatch(/"notification(s|_prefs|_deliveries)"/);
    // Buổi không bật sàn min-deduction: bản gốc không đọc sổ theo member nào.
    expect(
      sqls.filter((s) =>
        /from "financial_transactions"[\s\S]*"member_id" = \?/.test(s),
      ),
    ).toHaveLength(0);
    // Đúng 1 lần đọc công tắc.
    expect(
      spy.stmts.filter((s) => s.args.includes("notificationsEnabled")),
    ).toHaveLength(1);
    expect(await notes()).toHaveLength(0);
  });
});

describe("payments", () => {
  async function undoneDebt() {
    await linkAdmin();
    const a = await addMember();
    const sid = await addSession();
    await finalize(sid, [{ id: a }]);
    const debt = await debtOf(sid, a);
    expect(await undoPaymentByAdmin(debt.id)).toHaveProperty("success", true);
    return { a, sid, debt };
  }

  it("undoPaymentByAdmin twice sends exactly one payment_undone", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await undoneDebt();
    expect(await undoPaymentByAdmin(debt.id)).toHaveProperty("success", true);
    const sent = await notes("payment_undone");
    expect(sent).toHaveLength(1);
    expect(sent[0].recipientId).toBe(a);
    expect(sent[0].payload).toEqual({
      amount: debt.totalAmount,
      reason: "",
      balance: await balanceOf(a),
    });
  });

  it("confirmPaymentByMember notifies superadmins once; second call (already confirmed) sends nothing", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt, adminId } = await (async () => {
      const x = await undoneDebt();
      const [adm] = await testDb.select({ id: admins.id }).from(admins);
      return { ...x, adminId: adm.id };
    })();
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      facebookId: "fb",
    });
    expect(await confirmPaymentByMember(debt.id, key())).toEqual({
      success: true,
    });
    expect(await confirmPaymentByMember(debt.id, key())).toEqual({
      success: true,
    });
    const sent = await notes("member_reported_transfer");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientType: "admin",
      recipientId: adminId,
    });
    const [m] = await testDb
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, a));
    expect(sent[0].payload).toEqual({
      memberName: m.name,
      amount: debt.totalAmount,
      purpose: "debt",
      sessionDate: "2026-11-10",
    });
  });

  it("confirmPaymentByAdmin on an undone debt sends payment_confirmed once, without balance", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await undoneDebt();
    const k = key();
    await confirmPaymentByAdmin(debt.id, k);
    await confirmPaymentByAdmin(debt.id, key());
    const sent = await notes("payment_confirmed");
    expect(sent).toHaveLength(1);
    expect(sent[0].recipientId).toBe(a);
    expect(sent[0].payload).toEqual({ amount: debt.totalAmount });
    expect(sent[0].dedupKey).toBe(`paycf:d${debt.id}:${k}:m${a}`);
  });

  it("bank transfer paying all debts sends payment_confirmed per debt", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await undoneDebt();
    const r = await processPayment(
      {
        amount: debt.totalAmount,
        memo: `FWBB NO ${a}`,
        transId: "FT001",
        senderAccountNo: `acct-${seq}`,
      },
      "gmail-1",
    );
    expect(r.status).toBe("matched_debt");
    const sent = await notes("payment_confirmed");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ amount: debt.totalAmount });
    expect(sent[0].dedupKey).toBe(`bank:FT001:d${debt.id}:m${a}`);
  });
});

describe("fund", () => {
  /** Nợ đã hoàn tác: chỉ trạng thái này làm autoApplyFundToDebts trừ tiền. */
  async function memberWithUndoneDebt() {
    await linkAdmin();
    const a = await addMember();
    const sid = await addSession();
    await finalize(sid, [{ id: a }]);
    const debt = await debtOf(sid, a);
    await undoPaymentByAdmin(debt.id);
    return { a, debt };
  }

  it("balanceAfter equals getFundBalance after the action returns: recordContribution payload has no balance (autoApply runs after the tx)", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await memberWithUndoneDebt();
    const before = await balanceOf(a);
    await recordContribution(a, 500_000, undefined, key());
    // autoApply trừ nợ sau tx, nên số dư trong tx không phải số member thấy.
    expect(await balanceOf(a)).toBe(before + 500_000 - debt.totalAmount);
    const [n] = await notes("fund_contribution_recorded");
    expect(n.payload).toEqual({ amount: 500_000 });
  });

  it("balanceAfter equals getFundBalance after the action returns: confirmFundClaim payload has no balance", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await memberWithUndoneDebt();
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      facebookId: "fb",
    });
    expect(await claimFundContribution(400_000, key())).toEqual({
      success: true,
    });
    const claim = await testDb.query.paymentNotifications.findFirst({
      where: eq(paymentNotifications.senderBank, "manual"),
    });
    const before = await balanceOf(a);
    expect(await confirmFundClaim(claim!.id)).toHaveProperty("success", true);
    expect(await balanceOf(a)).toBe(before + 400_000 - debt.totalAmount);
    const [n] = await notes("fund_contribution_recorded");
    expect(n.recipientId).toBe(a);
    expect(n.payload).toEqual({ amount: 400_000 });
    expect(n.dedupKey).toBe(`fclaim:${claim!.id}:m${a}`);
  });

  it("balanceAfter equals getFundBalance after the action returns: matchFundContribution payload has no balance", async () => {
    await enableNotificationsForTest(testDb);
    const { a, debt } = await memberWithUndoneDebt();
    const before = await balanceOf(a);
    const r = await processPayment(
      {
        amount: 300_000,
        memo: `FWBB QUY ${a}`,
        transId: "FT777",
        senderAccountNo: `acct-${seq}`,
      },
      "gmail-777",
    );
    expect(r.status).toBe("matched_fund");
    expect(await balanceOf(a)).toBe(before + 300_000 - debt.totalAmount);
    const [n] = await notes("fund_contribution_recorded");
    expect(n.payload).toEqual({ amount: 300_000 });
    expect(n.dedupKey).toBe(`bank:FT777:m${a}`);
  });

  it("recordContribution replay with same idempotencyKey sends no second notification", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const a = await addMember();
    const k = key();
    await recordContribution(a, 100_000, undefined, k);
    const again = await recordContribution(a, 100_000, undefined, k);
    expect(again).toEqual({ success: true, replayed: true });
    const sent = await notes("fund_contribution_recorded");
    expect(sent).toHaveLength(1);
    expect(sent[0].dedupKey).toBe(`fcontrib:${k}:m${a}`);
  });

  it("claimFundContribution notifies superadmins with purpose fund", async () => {
    await enableNotificationsForTest(testDb);
    const { adminId } = await linkAdmin();
    const a = await addMember("Binh");
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: a,
      facebookId: "fb",
    });
    const k = key();
    await claimFundContribution(200_000, k);
    await claimFundContribution(200_000, k);
    const sent = await notes("member_reported_transfer");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      recipientType: "admin",
      recipientId: adminId,
      payload: { memberName: "Binh", amount: 200_000, purpose: "fund" },
      dedupKey: `fclaimreq:manual-fund-${a}-${k}:a${adminId}`,
    });
  });

  it("recordRefund sends fund_refund_recorded with the balance the member sees", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const a = await addMember();
    await recordContribution(a, 300_000, undefined, key());
    await recordRefund(a, 100_000, undefined, key());
    const [n] = await notes("fund_refund_recorded");
    expect(n.payload).toEqual({ amount: 100_000, balance: await balanceOf(a) });
    expect(await balanceOf(a)).toBe(200_000);
  });

  it("reverseFinancialTransaction sends transaction_reversed with the reason, once", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const a = await addMember();
    await recordContribution(a, 300_000, undefined, key());
    const contrib = await testDb.query.financialTransactions.findFirst({
      where: eq(financialTransactions.memberId, a),
    });
    const k = key();
    await reverseFinancialTransaction(contrib!.id, k, "nhap nham");
    await reverseFinancialTransaction(contrib!.id, key(), "nhap nham");
    const sent = await notes("transaction_reversed");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ amount: 300_000, reason: "nhap nham" });
    expect(sent[0].dedupKey).toBe(`txrev:${k}:m${a}`);
  });

  it("notification insert failure rolls back the money write", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const a = await addMember();
    await recordContribution(a, 300_000, undefined, key());
    await client.execute(
      "CREATE TRIGGER fail_notification_insert BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const r = await recordRefund(a, 100_000, undefined, key());
    expect(r).toHaveProperty("error");
    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, a),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);
    expect(await balanceOf(a)).toBe(300_000);
  });
});

describe("deleteSession refund", () => {
  async function snapshot(ids: number[]) {
    const out = new Map<number, number>();
    for (const id of ids) out.set(id, await balanceOf(id));
    return out;
  }

  async function expectRefundsMatch(
    ids: number[],
    before: Map<number, number>,
  ) {
    const sent = await notes("session_deleted_refund");
    for (const id of ids) {
      const after = await balanceOf(id);
      const delta = after - before.get(id)!;
      const mine = sent.filter((n) => n.recipientId === id);
      if (delta === 0) {
        expect(mine).toHaveLength(0);
      } else {
        expect(mine).toHaveLength(1);
        expect(mine[0].payload).toEqual({
          sessionDate: "2026-11-10",
          startTime: "20:30",
          amount: delta,
          balance: after,
        });
      }
    }
    return sent;
  }

  it("deleteSession refund amount equals each member's getFundBalance change: finalize, re-finalize, delete", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const [a, b] = [await addMember(), await addMember()];
    const sid = await addSession();
    await finalize(sid, [{ id: a }, { id: b }]);
    await finalize(sid, [{ id: a, dine: true }, { id: b }], 50_000);
    const before = await snapshot([a, b]);
    expect(await deleteSession(sid)).toEqual({ success: true });
    const sent = await expectRefundsMatch([a, b], before);
    expect(sent).toHaveLength(2);
    expect(sent[0].dedupKey).toMatch(new RegExp(`^sdel:s${sid}:m`));
  });

  it("deleteSession refund amount equals each member's getFundBalance change: finalize, unlock, delete sends nothing", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const [a, b] = [await addMember(), await addMember()];
    const sid = await addSession();
    await finalize(sid, [{ id: a }, { id: b }]);
    await unlockSession(sid);
    const before = await snapshot([a, b]);
    expect(await deleteSession(sid)).toEqual({ success: true });
    const sent = await expectRefundsMatch([a, b], before);
    expect(sent).toHaveLength(0);
  });

  it("deleteSession refund amount equals each member's getFundBalance change: pass revenue credited to the admin member", async () => {
    await enableNotificationsForTest(testDb);
    const { adminMemberId } = await linkAdmin();
    const sid = await addSession({ status: "voting" });
    expect(
      await cancelSession(sid, { passed: true, passRevenue: 150_000 }),
    ).toHaveProperty("success", true);
    const before = await snapshot([adminMemberId]);
    expect(await deleteSession(sid)).toEqual({ success: true });
    const sent = await expectRefundsMatch([adminMemberId], before);
    expect(sent).toHaveLength(1);
    expect((sent[0].payload as { amount: number }).amount).toBe(-150_000);
  });
});
