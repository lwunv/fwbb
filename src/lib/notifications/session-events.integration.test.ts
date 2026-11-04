import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  financialTransactions,
  members,
  notifications,
  sessions,
  votes,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ymdInVNAddDays } from "@/lib/date-format";
import { nowDeadlineVN } from "@/lib/vote-deadline";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(() => ""),
  buildConfirmedMessage: vi.fn(() => ""),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const {
  cancelSession,
  reopenSession,
  setSessionTime,
  setSessionCourtPriceOverride,
  extendVoteDeadline,
  createSessionManually,
} = await import("@/actions/sessions");
const { notifySessionOpened, shouldNotifyVoteReopened } =
  await import("./session-events");
const { sessionStartInstant } = await import("./time");
const { enableNotificationsForTest } = await import("./test-helpers");
const { requireAdmin } = await import("@/lib/auth");

const HOUR = 3_600_000;

async function reset() {
  for (const t of [
    "notifications",
    "notification_prefs",
    "financial_transactions",
    "session_debts",
    "session_attendees",
    "session_shuttlecocks",
    "votes",
    "sessions",
    "admins",
    "members",
    "courts",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

let seq = 0;
async function addMember(
  opts: {
    isActive?: boolean;
    approvalStatus?: "pending" | "approved" | "rejected";
  } = {},
) {
  seq++;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      facebookId: `fb-${seq}`,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

async function addSession(
  values: Partial<typeof sessions.$inferInsert> & { date: string },
) {
  const [s] = await testDb
    .insert(sessions)
    .values({ status: "voting", ...values })
    .returning({ id: sessions.id });
  return s.id;
}

async function vote(
  sessionId: number,
  memberId: number,
  willPlay: boolean,
  willDine: boolean,
) {
  await testDb
    .insert(votes)
    .values({ sessionId, memberId, willPlay, willDine });
}

async function rows(kind?: string) {
  const all = await testDb
    .select({
      recipientId: notifications.recipientId,
      kind: notifications.kind,
      payload: notifications.payload,
      dedupKey: notifications.dedupKey,
    })
    .from(notifications);
  return kind ? all.filter((r) => r.kind === kind) : all;
}

const ids = (list: { recipientId: number }[]) =>
  list.map((r) => r.recipientId).sort((a, b) => a - b);

/** Ngày + giờ VN của mốc `ms`, để dựng buổi bắt đầu đúng N giờ sau `now`. */
function vnDateTime(ms: number) {
  const s = nowDeadlineVN(new Date(ms));
  return { date: s.slice(0, 10), startTime: s.slice(11, 16) };
}

/** Admin có member gắn kèm (để ghi tiền pass sân) và requireAdmin trỏ vào. */
async function linkAdmin() {
  const memberId = await addMember();
  const [a] = await testDb
    .insert(admins)
    .values({ username: `admin${seq}`, passwordHash: "hash", memberId })
    .returning({ id: admins.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(a.id), role: "admin" },
  } as never);
  return memberId;
}

/** Buổi có: A vote chơi, B chỉ ăn, C chưa vote, D xoá vote (dòng false/false). */
async function sessionWithVoters(date = "2026-11-20") {
  const [a, b, c, d] = [
    await addMember(),
    await addMember(),
    await addMember(),
    await addMember(),
  ];
  const sid = await addSession({ date });
  await vote(sid, a, true, false);
  await vote(sid, b, false, true);
  await vote(sid, d, false, false);
  return { sid, a, b, c, d };
}

/**
 * Client file của test mở kết nối mới (không có busy_timeout) cho mỗi
 * transaction, nên hai BEGIN IMMEDIATE cùng lúc báo SQLITE_BUSY ngay. Turso thì
 * xếp hàng người ghi. Xếp hàng các transaction ở đây để mô phỏng việc chờ khoá;
 * các lần gọi song song vẫn đọc trạng thái cũ trước khi vào tx. `beforeEach`
 * chạy ngay trước mỗi transaction (mô phỏng thao tác khác chen vào).
 */
async function withQueuedTransactions<T>(
  run: () => Promise<T>,
  beforeEachTx?: () => Promise<void>,
): Promise<T> {
  const realTransaction = testDb.transaction.bind(testDb);
  let queue: Promise<unknown> = Promise.resolve();
  const spy = vi.spyOn(testDb, "transaction").mockImplementation(((
    ...args: Parameters<typeof realTransaction>
  ) => {
    const next = queue.then(async () => {
      await beforeEachTx?.();
      return realTransaction(...args);
    });
    queue = next.catch(() => undefined);
    return next;
  }) as typeof testDb.transaction);
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}

beforeEach(reset);

describe("sessionStartInstant", () => {
  it("pins the session wall clock to Vietnam time", () => {
    expect(sessionStartInstant("2026-11-05", "20:30").toISOString()).toBe(
      "2026-11-05T13:30:00.000Z",
    );
  });
});

describe("session opened", () => {
  it("opened: session in 30h notifies all active approved members once; session in 5 days notifies nobody", async () => {
    await enableNotificationsForTest(testDb);
    const a = await addMember();
    const b = await addMember();
    await addMember({ isActive: false });
    await addMember({ approvalStatus: "pending" });
    const now = new Date("2026-11-10T00:00:00.000Z");

    const near = await addSession(vnDateTime(now.getTime() + 30 * HOUR));
    await notifySessionOpened(testDb, near, now);
    await notifySessionOpened(testDb, near, now);
    const opened = await rows("session_opened");
    expect(ids(opened)).toEqual([a, b].sort((x, y) => x - y));
    expect(opened[0].dedupKey).toMatch(new RegExp(`^sopen:s${near}:m\\d+$`));

    const far = await addSession(vnDateTime(now.getTime() + 5 * 24 * HOUR));
    await notifySessionOpened(testDb, far, now);
    expect(await rows("session_opened")).toHaveLength(2);
  });

  it("does not announce a session whose vote is already closed", async () => {
    await enableNotificationsForTest(testDb);
    await addMember();
    const now = new Date("2026-11-10T00:00:00.000Z");
    const sid = await addSession({
      ...vnDateTime(now.getTime() + 30 * HOUR),
      voteDeadline: nowDeadlineVN(new Date(now.getTime() - HOUR)),
    });
    await notifySessionOpened(testDb, sid, now);
    expect(await rows()).toHaveLength(0);
  });

  it('a session cancelled before entering the 48h window gets no "session opened" notification', async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    await addMember();
    const created = new Date("2026-11-10T00:00:00.000Z");
    const start = created.getTime() + 5 * 24 * HOUR;
    const sid = await addSession(vnDateTime(start));
    await notifySessionOpened(testDb, sid, created);

    expect(await cancelSession(sid)).toEqual({ success: true });
    // Ngày cron hằng ngày (Task 19) gọi lại khi buổi vào khung 48h.
    await notifySessionOpened(testDb, sid, new Date(start - 30 * HOUR));
    expect(await rows("session_opened")).toHaveLength(0);
  });

  it("createSessionManually for tomorrow announces the session to members", async () => {
    await enableNotificationsForTest(testDb);
    const m = await addMember();
    const r = await createSessionManually(ymdInVNAddDays(1), "20:30", "22:30");
    expect(r).toEqual({ success: true });
    expect(ids(await rows("session_opened"))).toContain(m);
  });
});

describe("session changed", () => {
  it("setSessionTime same values sends nothing; new time notifies voters only with new time in payload", async () => {
    await enableNotificationsForTest(testDb);
    const { sid, a, b } = await sessionWithVoters();

    expect(await setSessionTime(sid, "20:30", "22:30")).toEqual({
      success: true,
    });
    expect(await rows()).toHaveLength(0);

    expect(await setSessionTime(sid, "19:00", "21:00")).toEqual({
      success: true,
    });
    const changed = await rows("session_changed");
    expect(ids(changed)).toEqual([a, b].sort((x, y) => x - y));
    expect(changed[0].payload).toMatchObject({
      sessionDate: "2026-11-20",
      startTime: "19:00",
      endTime: "21:00",
      fields: ["time"],
    });
  });
  it("court price override notifies voters once per real change, with the new price", async () => {
    await enableNotificationsForTest(testDb);
    const { sid, a, b } = await sessionWithVoters();
    await testDb
      .update(sessions)
      .set({ courtPrice: 200_000 })
      .where(eq(sessions.id, sid));

    expect(await setSessionCourtPriceOverride(sid, 200_000)).toEqual({
      success: true,
    });
    expect(await rows()).toHaveLength(0);

    expect(await setSessionCourtPriceOverride(sid, 240_000)).toEqual({
      success: true,
    });
    const changed = await rows("session_changed");
    expect(ids(changed)).toEqual([a, b].sort((x, y) => x - y));
    expect(changed[0].payload).toMatchObject({
      fields: ["price"],
      courtPrice: 240_000,
    });
  });
});

describe("cancel and reopen", () => {
  it("cancel then cancel again: one notification; cancel, reopen, cancel: two cancel notifications", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const { sid, a, b } = await sessionWithVoters();

    expect(await cancelSession(sid)).toEqual({ success: true });
    expect(await cancelSession(sid)).toEqual({
      success: true,
      alreadyCancelled: true,
    });
    expect(ids(await rows("session_cancelled"))).toEqual(
      [a, b].sort((x, y) => x - y),
    );

    expect(await reopenSession(sid)).toEqual({ success: true });
    expect(ids(await rows("session_reopened"))).toEqual(
      [a, b].sort((x, y) => x - y),
    );
    // Hai lần hủy liên tiếp phải mang token khác nhau.
    await new Promise((r) => setTimeout(r, 5));
    expect(await cancelSession(sid)).toEqual({ success: true });
    expect(await rows("session_cancelled")).toHaveLength(4);
  });

  it("two concurrent cancelSession calls (Promise.all) send one notification per voter and record pass revenue once", async () => {
    await enableNotificationsForTest(testDb);
    const adminMemberId = await linkAdmin();
    const { sid, a, b } = await sessionWithVoters();

    const results = await withQueuedTransactions(() =>
      Promise.all([
        cancelSession(sid, { passed: true, passRevenue: 100_000 }),
        cancelSession(sid, { passed: true, passRevenue: 100_000 }),
      ]),
    );
    expect(results).toContainEqual({ success: true });
    expect(results).toContainEqual({ success: true, alreadyCancelled: true });

    expect(ids(await rows("session_cancelled"))).toEqual(
      [a, b].sort((x, y) => x - y),
    );
    const pass = await testDb
      .select({ amount: financialTransactions.amount })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.sessionId, sid),
          eq(financialTransactions.type, "fund_contribution"),
          eq(financialTransactions.memberId, adminMemberId),
        ),
      );
    expect(pass).toEqual([{ amount: 100_000 }]);
  });

  it("two concurrent reopenSession calls reverse the pass revenue once; the loser rolls back and gets onlyCancelledCanReopen", async () => {
    await enableNotificationsForTest(testDb);
    const adminMemberId = await linkAdmin();
    const { sid, a, b } = await sessionWithVoters();
    expect(
      await cancelSession(sid, { passed: true, passRevenue: 120_000 }),
    ).toEqual({ success: true });
    const [contribution] = await testDb
      .select({ id: financialTransactions.id })
      .from(financialTransactions)
      .where(eq(financialTransactions.type, "fund_contribution"));

    const results = await withQueuedTransactions(() =>
      Promise.all([reopenSession(sid), reopenSession(sid)]),
    );
    expect(results).toContainEqual({ success: true });
    expect(results).toContainEqual({ error: "onlyCancelledCanReopen" });

    const deductions = await testDb
      .select({
        reversalOfId: financialTransactions.reversalOfId,
        amount: financialTransactions.amount,
        memberId: financialTransactions.memberId,
      })
      .from(financialTransactions)
      .where(eq(financialTransactions.type, "fund_deduction"));
    expect(deductions).toEqual([
      {
        reversalOfId: contribution.id,
        amount: 120_000,
        memberId: adminMemberId,
      },
    ]);
    expect(ids(await rows("session_reopened"))).toEqual(
      [a, b].sort((x, y) => x - y),
    );
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sid),
    });
    expect(s?.status).toBe("voting");
  });

  it("cancelSession on a session finalized after the first read returns cannotCancelCompleted and writes nothing", async () => {
    await enableNotificationsForTest(testDb);
    await linkAdmin();
    const { sid } = await sessionWithVoters();

    // Chốt sổ chen vào giữa bước đọc trạng thái và UPDATE có điều kiện.
    const r = await withQueuedTransactions(
      () => cancelSession(sid, { passed: true, passRevenue: 100_000 }),
      async () => {
        await testDb
          .update(sessions)
          .set({ status: "completed" })
          .where(eq(sessions.id, sid));
      },
    );
    expect(r).toEqual({ error: "cannotCancelCompleted" });
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sid),
    });
    expect(s?.status).toBe("completed");
    expect(s?.passRevenue).toBeNull();
    expect(await testDb.query.financialTransactions.findMany({})).toEqual([]);
    expect(await rows()).toHaveLength(0);
  });

  it("switch off: cancelSession result and DB state identical to before, zero notification rows", async () => {
    const adminMemberId = await linkAdmin();
    const { sid } = await sessionWithVoters();

    const r = await cancelSession(sid, { passed: true, passRevenue: 150_000 });
    expect(r).toEqual({ success: true });
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sid),
    });
    expect(s?.status).toBe("cancelled");
    expect(s?.passRevenue).toBe(150_000);
    const txs = await testDb.query.financialTransactions.findMany({});
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      type: "fund_contribution",
      direction: "in",
      amount: 150_000,
      memberId: adminMemberId,
      sessionId: sid,
      idempotencyKey: `session-pass-${sid}-0`,
    });
    expect(await cancelSession(sid)).toEqual({
      success: true,
      alreadyCancelled: true,
    });
    expect(await rows()).toHaveLength(0);
  });
});

describe("vote reopened", () => {
  it("extendVoteDeadline notifies only members who have not voted", async () => {
    await enableNotificationsForTest(testDb);
    const { sid, c, d } = await sessionWithVoters();
    await testDb
      .update(sessions)
      .set({ voteDeadline: nowDeadlineVN(new Date(Date.now() - HOUR)) })
      .where(eq(sessions.id, sid));

    const r = await extendVoteDeadline(sid, 2);
    expect("error" in r).toBe(false);
    const reopened = await rows("vote_reopened");
    expect(ids(reopened)).toEqual([c, d].sort((x, y) => x - y));
    expect(reopened[0].payload).toMatchObject({
      voteDeadline: (r as { voteDeadline: string }).voteDeadline,
    });
  });

  it("an extension that still ends in the past sends nothing", () => {
    const now = new Date("2026-11-10T12:00:00.000Z"); // 19:00 VN
    const closed = {
      status: "voting" as const,
      voteDeadline: "2026-11-10T16:00:00",
    };
    // Kết quả cũ của extendVoteDeadline trên server UTC: lệch 7 tiếng, vẫn ở quá khứ.
    expect(shouldNotifyVoteReopened(closed, "2026-11-10T18:00:00", now)).toBe(
      false,
    );
    expect(shouldNotifyVoteReopened(closed, "2026-11-10T21:00:00", now)).toBe(
      true,
    );
    expect(shouldNotifyVoteReopened(closed, null, now)).toBe(true);
    // Vote đang mở: chỉ gửi khi hạn mới muộn hơn hạn cũ.
    const open = {
      status: "voting" as const,
      voteDeadline: "2026-11-10T22:00:00",
    };
    expect(shouldNotifyVoteReopened(open, "2026-11-10T21:00:00", now)).toBe(
      false,
    );
    expect(shouldNotifyVoteReopened(open, "2026-11-11T00:00:00", now)).toBe(
      true,
    );
    expect(
      shouldNotifyVoteReopened(
        { status: "voting", voteDeadline: null },
        "2026-11-11T00:00:00",
        now,
      ),
    ).toBe(false);
  });
});
