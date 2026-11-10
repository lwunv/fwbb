process.env.TZ = "UTC";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  appSettings,
  courts,
  financialTransactions,
  members,
  notificationDeliveries,
  notifications,
  scheduledJobs,
  sessions,
} from "@/db/schema";
import type { MailMessage, MailOutcome } from "@/lib/mailer";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const mailer = vi.hoisted(() => ({
  sendMail: vi.fn<(msg: MailMessage) => Promise<MailOutcome>>(),
}));
vi.mock("@/lib/mailer", () => mailer);

// QStash giả: mặc định "chưa cấu hình"; test bật bằng qstash.configured.
const qstash = vi.hoisted(() => {
  let n = 0;
  const state = { configured: false };
  return {
    state,
    QSTASH_MAX_DELAY_MS: 7 * 24 * 3_600_000,
    getQstashConfig: vi.fn(() =>
      state.configured
        ? { token: "t", currentSigningKey: "c", nextSigningKey: "n" }
        : null,
    ),
    publishJob: vi.fn<
      (job: {
        jobKey: string;
        runAt: Date;
        revision?: number;
      }) => Promise<{ messageId: string } | null>
    >(async () => (state.configured ? { messageId: `msg-${++n}` } : null)),
    cancelJobMessage: vi.fn<(id: string) => Promise<void>>(async () => {}),
  };
});
vi.mock("./qstash", () => qstash);

const pending = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock("./after", () => ({
  runAfterResponse: (fn: () => Promise<unknown>) => {
    pending.push(fn);
  },
}));

const { runDailyNotifications, runMorningMail } = await import("./daily");
const { notify } = await import("./notify");
const { enableNotificationsForTest } = await import("./test-helpers");

const DAY_MS = 24 * 3_600_000;
const iso = (s: string) => new Date(s).toISOString();
/** Lượt cron 06:00 VN của ngày VN `ymd` (chạy lúc 23:30Z hôm trước). */
const cronAt = (ymd: string) => new Date(`${ymd}T06:30:00+07:00`);
const addDaysYmd = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);

async function reset() {
  for (const t of [
    "scheduled_jobs",
    "notification_deliveries",
    "notifications",
    "notification_prefs",
    "financial_transactions",
    "session_debts",
    "votes",
    "session_shuttlecocks",
    "sessions",
    "courts",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  mailer.sendMail.mockReset();
  mailer.sendMail.mockResolvedValue({ ok: true });
  qstash.state.configured = false;
  qstash.publishJob.mockClear();
  pending.length = 0;
}

let seq = 0;
async function addMember(opts: { email?: boolean } = {}) {
  seq++;
  const email = opts.email ? `m${seq}@example.test` : null;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      facebookId: `fb-daily-${seq}`,
      email,
      notifyEmailVerifiedFor: email,
    })
    .returning({ id: members.id });
  return m.id;
}

async function addSuperadmin(email: string | null = null) {
  const [a] = await testDb
    .insert(admins)
    .values({
      username: `sa${++seq}`,
      passwordHash: "x",
      role: "superadmin",
      email,
    })
    .returning({ id: admins.id });
  return a.id;
}

async function ledger(
  memberId: number,
  type: "fund_contribution" | "fund_deduction",
  amount: number,
  at: Date,
) {
  await testDb.insert(financialTransactions).values({
    type,
    direction: type === "fund_contribution" ? "in" : "out",
    amount,
    memberId,
    createdAt: at.toISOString(),
  });
}

async function notificationsOf(kind: string) {
  return testDb
    .select()
    .from(notifications)
    .where(eq(notifications.kind, kind))
    .orderBy(notifications.id);
}

describe("runDailyNotifications", () => {
  beforeEach(async () => {
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("does nothing but read the switch when notifications are off", async () => {
    await client.execute(
      "UPDATE app_settings SET value = 'false' WHERE key = 'notificationsEnabled'",
    );
    const m = await addMember();
    await ledger(m, "fund_deduction", 60_000, new Date("2026-11-02T15:30:00Z"));
    const report = await runDailyNotifications(testDb, cronAt("2026-11-03"));
    expect(report).toMatchObject({ debtReminders: 0, errors: [] });
    expect(await testDb.select().from(notifications)).toHaveLength(0);
  });

  it("member playing Mon/Wed/Fri who stays at -60.000 gets one reminder on each of day 1, 7, 14, 30 of debt age and none after; never two in one day", async () => {
    const m = await addMember();
    // Thứ 2 2/11 tới hết 10/12: chạy cron mỗi sáng, sau đó ghi sổ buổi tối.
    // Buổi đầu trừ 60K (về -60K); mỗi buổi sau trừ 60K rồi nạp 60K ngay
    // trong tối đó, nên số dư đứng ở -60K và chưa lúc nào về ≥ 0.
    let first = true;
    for (
      let ymd = "2026-11-02";
      ymd <= "2026-12-10";
      ymd = addDaysYmd(ymd, 1)
    ) {
      const report = await runDailyNotifications(testDb, cronAt(ymd));
      expect(report.errors).toEqual([]);
      if (ymd === "2026-11-09") {
        // Chạy lại trong cùng ngày: không thêm tin.
        const again = await runDailyNotifications(testDb, cronAt(ymd));
        expect(again.debtReminders).toBe(0);
      }
      const dow = new Date(`${ymd}T12:00:00+07:00`).getUTCDay();
      if (dow === 1 || dow === 3 || dow === 5) {
        await ledger(
          m,
          "fund_deduction",
          60_000,
          new Date(`${ymd}T22:30:00+07:00`),
        );
        if (!first) {
          await ledger(
            m,
            "fund_contribution",
            60_000,
            new Date(`${ymd}T22:45:00+07:00`),
          );
        }
        first = false;
      }
    }

    const sent = await notificationsOf("debt_reminder");
    expect(
      sent.map((n) => ({
        to: n.recipientId,
        payload: n.payload,
        day: new Date(new Date(n.createdAt).getTime() + 7 * 3_600_000)
          .toISOString()
          .slice(0, 10),
        dedupKey: n.dedupKey,
      })),
    ).toEqual([
      {
        to: m,
        payload: { amount: 60_000, days: 1 },
        day: "2026-11-03",
        dedupKey: `debt:m${m}:2026-11-03:m${m}`,
      },
      {
        to: m,
        payload: { amount: 60_000, days: 7 },
        day: "2026-11-09",
        dedupKey: `debt:m${m}:2026-11-09:m${m}`,
      },
      {
        to: m,
        payload: { amount: 60_000, days: 14 },
        day: "2026-11-16",
        dedupKey: `debt:m${m}:2026-11-16:m${m}`,
      },
      {
        to: m,
        payload: { amount: 60_000, days: 30 },
        day: "2026-12-02",
        dedupKey: `debt:m${m}:2026-12-02:m${m}`,
      },
    ]);
  });

  it("no reminder for -9.000 or for a member who paid", async () => {
    const small = await addMember();
    const paid = await addMember();
    await ledger(
      small,
      "fund_deduction",
      9_000,
      new Date("2026-11-02T22:30:00+07:00"),
    );
    await ledger(
      paid,
      "fund_deduction",
      60_000,
      new Date("2026-11-02T22:30:00+07:00"),
    );
    await ledger(
      paid,
      "fund_contribution",
      60_000,
      new Date("2026-11-02T23:00:00+07:00"),
    );

    const report = await runDailyNotifications(testDb, cronAt("2026-11-03"));
    expect(report.debtReminders).toBe(0);
    expect(await notificationsOf("debt_reminder")).toHaveLength(0);
  });

  it("now = 2026-11-08T23:30:00Z (Mon Nov 9 VN) creates weekly_summary; now = 2026-11-30T23:30:00Z (Dec 1 VN) checks November court rent", async () => {
    const admin = await addSuperadmin();
    // Một người nợ từ 1/10 (quá 30 ngày tới 9/11), một người chờ duyệt.
    const debtor = await addMember();
    await ledger(
      debtor,
      "fund_deduction",
      50_000,
      new Date("2026-10-01T22:30:00+07:00"),
    );
    await testDb.insert(members).values({
      name: "Chờ",
      facebookId: "fb-wait",
      approvalStatus: "pending",
    });
    const [court] = await testDb
      .insert(courts)
      .values({ name: "Sân A", pricePerSession: 200_000 })
      .returning({ id: courts.id });
    await testDb.insert(appSettings).values([
      { key: "defaultCourtId", value: String(court.id) },
      { key: "sessionDaysOfWeek", value: "1,3,5" },
    ]);
    await testDb.insert(sessions).values([
      {
        date: "2026-11-09",
        status: "voting",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-11-11",
        status: "voting",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-11-13",
        status: "cancelled",
        courtId: court.id,
        courtPrice: 200_000,
      },
    ]);

    qstash.state.configured = true;
    const monday = await runDailyNotifications(
      testDb,
      new Date("2026-11-08T23:30:00Z"),
    );
    expect(monday.errors).toEqual([]);
    expect(monday.rentChecked).toBe(false);
    const [job] = await testDb
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.kind, "weekly_summary"));
    expect(job).toMatchObject({
      jobKey: "weekly_summary:2026-11-09",
      runAt: iso("2026-11-09T08:00:00+07:00"),
      status: "scheduled",
      messageId: expect.stringMatching(/^msg-/),
    });
    expect(qstash.publishJob).toHaveBeenCalledWith({
      jobKey: "weekly_summary:2026-11-09",
      runAt: new Date("2026-11-09T08:00:00+07:00"),
    });

    // QStash gọi lại lúc 08:00: tin cho superadmin, chạy hai lần vẫn một tin.
    const { runJob } = await import("./jobs");
    const at8 = new Date("2026-11-09T08:00:00+07:00");
    expect(await runJob(testDb, job, at8)).toBe("done");
    expect(await runJob(testDb, job, at8)).toBe("done");
    const weekly = await notificationsOf("weekly_summary");
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({
      recipientType: "admin",
      recipientId: admin,
      payload: { debtorCount: 1, upcomingCount: 2, pendingCount: 1 },
      dedupKey: `weekly:2026-11-09:a${admin}`,
    });

    // Không phải thứ 2: không tạo job tuần.
    await runDailyNotifications(testDb, new Date("2026-11-09T23:30:00Z"));
    expect(
      await testDb
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.kind, "weekly_summary")),
    ).toHaveLength(1);

    // 1/12 VN: tiền sân tháng 11 = 13 ngày T2/T4/T6 × 200K, chưa trả đồng nào.
    const dec1 = await runDailyNotifications(
      testDb,
      new Date("2026-11-30T23:30:00Z"),
    );
    expect(dec1.errors).toEqual([]);
    expect(dec1.rentChecked).toBe(true);
    const rent = await notificationsOf("court_rent_unpaid");
    expect(rent).toHaveLength(1);
    expect(rent[0]).toMatchObject({
      recipientId: admin,
      payload: { month: "2026-11", amount: 13 * 200_000 },
      dedupKey: `rent:2026-11:a${admin}`,
    });

    // Ngày 6 không kiểm tiền sân nữa.
    const dec6 = await runDailyNotifications(
      testDb,
      new Date("2026-12-05T23:30:00Z"),
    );
    expect(dec6.rentChecked).toBe(false);
  });

  it("runs weekly_summary straight away when QStash is not configured", async () => {
    const admin = await addSuperadmin();
    const report = await runDailyNotifications(
      testDb,
      new Date("2026-11-08T23:30:00Z"),
    );
    expect(report.errors).toEqual([]);
    const [job] = await testDb
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.kind, "weekly_summary"));
    expect(job.status).toBe("done");
    expect(await notificationsOf("weekly_summary")).toMatchObject([
      {
        recipientId: admin,
        payload: { debtorCount: 0, upcomingCount: 0, pendingCount: 0 },
      },
    ]);
  });

  it("weekly_summary lists up to 20 long-term debtors by amount, with the full count", async () => {
    const admin = await addSuperadmin();
    // 22 người nợ từ 1/10 (quá 30 ngày tới 9/11): người thứ i nợ (10 + i) nghìn.
    const debtors: { id: number; amount: number }[] = [];
    for (let i = 1; i <= 22; i++) {
      const id = await addMember();
      const amount = (10 + i) * 1_000;
      await ledger(
        id,
        "fund_deduction",
        amount,
        new Date("2026-10-01T22:30:00+07:00"),
      );
      debtors.push({ id, amount });
    }
    // Nợ mới 5 ngày và nợ lâu nhưng dưới 10K: không tính.
    const recent = await addMember();
    await ledger(
      recent,
      "fund_deduction",
      500_000,
      new Date("2026-11-04T22:30:00+07:00"),
    );
    const small = await addMember();
    await ledger(
      small,
      "fund_deduction",
      9_000,
      new Date("2026-10-01T22:30:00+07:00"),
    );
    const names = new Map(
      (await testDb.select().from(members)).map((m) => [m.id, m.name]),
    );

    const report = await runDailyNotifications(
      testDb,
      new Date("2026-11-08T23:30:00Z"),
    );
    expect(report.errors).toEqual([]);
    const [sent] = await notificationsOf("weekly_summary");
    expect(sent.recipientId).toBe(admin);
    const payload = sent.payload as {
      debtorCount: number;
      debtors: { name: string; amount: number }[];
    };
    expect(payload.debtorCount).toBe(22);
    const expected = [...debtors]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)
      .map((d) => ({ name: names.get(d.id), amount: d.amount }));
    expect(payload.debtors).toEqual(expected);
    expect(payload.debtors.every((d) => Number.isInteger(d.amount))).toBe(true);
  });

  it("a failing step records its code with the error name, never the message", async () => {
    await addSuperadmin();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Bảng sân đề xuất biến mất: bước tóm tắt tuần (đếm việc chờ duyệt) lỗi.
    await client.execute("ALTER TABLE venues RENAME TO venues_gone");
    try {
      const report = await runDailyNotifications(
        testDb,
        new Date("2026-11-08T23:30:00Z"),
      );
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toMatch(/^weekly:[A-Za-z]*Error$/);
      const [, fields] = log.mock.calls.find(
        ([msg]) => msg === "[Notify] daily_step_failed",
      )!;
      expect(fields).toEqual({
        step: "weekly",
        error: report.errors[0].slice("weekly:".length),
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("venues");
    } finally {
      await client.execute("ALTER TABLE venues_gone RENAME TO venues");
      log.mockRestore();
    }
  });

  it("reports a reconcile error to superadmins without member figures, once a day", async () => {
    const admin = await addSuperadmin();
    // Số âm trong sổ: I5 báo lỗi.
    await client.execute(
      "INSERT INTO financial_transactions (type, direction, amount, idempotency_key) VALUES ('fund_contribution', 'in', 1.5, 'k-bad')",
    );
    const now = cronAt("2026-11-10");
    const first = await runDailyNotifications(testDb, now);
    expect(first.reconcileChecked).toBe(true);
    await runDailyNotifications(testDb, now);
    const sent = await notificationsOf("reconcile_failed");
    expect(sent).toHaveLength(1);
    // Số lẻ không gắn member: I5 (không nguyên) và I1 (tổng lệch số dư).
    expect(sent[0]).toMatchObject({
      recipientId: admin,
      payload: { errorCount: 2 },
      dedupKey: `reconcile:2026-11-10:a${admin}`,
    });
  });

  it("missed scheduled job older than 10 minutes is run by the daily sweep; digest claim rows are never picked by the sweep", async () => {
    const admin = await addSuperadmin();
    const now = cronAt("2026-11-10");
    const nowIso = now.toISOString();
    const old = new Date(now.getTime() - 30 * 60_000).toISOString();
    const recent = new Date(now.getTime() - 5 * 60_000).toISOString();
    const base = {
      sessionId: null,
      messageId: null,
      createdAt: old,
      updatedAt: old,
    };
    await testDb.insert(scheduledJobs).values([
      {
        ...base,
        jobKey: "weekly_summary:2026-11-09",
        kind: "weekly_summary",
        runAt: old,
        status: "scheduled",
        payload: { debtorCount: 2, upcomingCount: 3, pendingCount: 0 },
      },
      {
        ...base,
        jobKey: "outbox_retry:recent",
        kind: "outbox_retry",
        runAt: recent,
        status: "scheduled",
        payload: {},
      },
      {
        ...base,
        jobKey: "digest:2026-11-09:m1",
        kind: "digest",
        runAt: old,
        status: "done",
        payload: {},
      },
    ]);

    const report = await runDailyNotifications(testDb, now);
    expect(report.jobsRun).toBe(1);
    const jobs = await testDb
      .select()
      .from(scheduledJobs)
      .orderBy(scheduledJobs.id);
    expect(jobs.map((j) => [j.jobKey, j.status, j.updatedAt])).toEqual([
      ["weekly_summary:2026-11-09", "done", nowIso],
      ["outbox_retry:recent", "scheduled", old],
      ["digest:2026-11-09:m1", "done", old],
    ]);
    expect(await notificationsOf("weekly_summary")).toMatchObject([
      {
        recipientId: admin,
        payload: { debtorCount: 2, upcomingCount: 3, pendingCount: 0 },
      },
    ]);
  });

  it("announces sessions opening within 48h and keeps their reminder jobs in sync", async () => {
    const m = await addMember();
    const now = cronAt("2026-11-10");
    await testDb.insert(sessions).values([
      { date: "2026-11-11", status: "voting", startTime: "20:30" },
      { date: "2026-11-16", status: "voting", startTime: "20:30" },
      { date: "2026-11-25", status: "voting", startTime: "20:30" },
    ]);
    const report = await runDailyNotifications(testDb, now);
    expect(report.errors).toEqual([]);
    expect(report.opened).toBe(1);
    expect(report.rescheduled).toBe(2);
    expect(await notificationsOf("session_opened")).toMatchObject([
      { recipientId: m, payload: { sessionDate: "2026-11-11" } },
    ]);
    const jobSessions = new Set(
      (await testDb.select().from(scheduledJobs)).map((j) => j.sessionId),
    );
    expect(jobSessions.size).toBe(2);
  });

  it("cleanup removes only read notifications older than 90 days and finished deliveries/jobs older than 30 days", async () => {
    const now = cronAt("2026-11-10");
    const ago = (days: number) =>
      new Date(now.getTime() - days * DAY_MS).toISOString();
    const n = (createdAt: string, readAt: string | null, key: string) => ({
      recipientType: "member" as const,
      recipientId: 1,
      kind: "session_opened",
      payload: {},
      createdAt,
      readAt,
      dedupKey: key,
    });
    const rows = await testDb
      .insert(notifications)
      .values([
        n(ago(91), ago(80), "old-read"),
        n(ago(91), null, "old-unread"),
        n(ago(89), ago(80), "recent-read"),
      ])
      .returning({ id: notifications.id, dedupKey: notifications.dedupKey });
    const keep = rows.filter((r) => r.dedupKey !== "old-read");
    const d = (
      notificationId: number,
      status: "sent" | "pending" | "failed",
      createdAt: string,
    ) => ({
      notificationId,
      recipientType: "member" as const,
      recipientId: 1,
      channel: "email" as const,
      status,
      // Dòng pending hẹn ở tương lai: bước gửi mail không đụng tới.
      nextAttemptAt: status === "pending" ? ago(-1) : createdAt,
      createdAt,
    });
    // Mỗi tin một delivery (unique theo tin + kênh); tạo thêm tin giữ lại.
    const holders = await testDb
      .insert(notifications)
      .values([n(ago(1), null, "h1"), n(ago(1), null, "h2")])
      .returning({ id: notifications.id });
    await testDb
      .insert(notificationDeliveries)
      .values([
        d(keep[0].id, "sent", ago(31)),
        d(keep[1].id, "pending", ago(31)),
        d(holders[0].id, "failed", ago(29)),
      ]);
    const j = (
      jobKey: string,
      status: "done" | "scheduled" | "cancelled",
      updatedAt: string,
    ) => ({
      jobKey,
      kind: "outbox_retry",
      sessionId: null,
      // Job "scheduled" để ở tương lai: bước quét bù không đụng tới.
      runAt: status === "scheduled" ? ago(-2) : updatedAt,
      status,
      messageId: null,
      payload: {},
      createdAt: updatedAt,
      updatedAt,
    });
    await testDb
      .insert(scheduledJobs)
      .values([
        j("done-old", "done", ago(31)),
        j("scheduled-old", "scheduled", ago(31)),
        j("cancelled-recent", "cancelled", ago(29)),
      ]);

    const report = await runDailyNotifications(testDb, now);
    expect(report.errors).toEqual([]);
    expect(report.cleaned).toBe(3);
    expect(
      (await testDb.select().from(notifications)).map((r) => r.dedupKey).sort(),
    ).toEqual(["h1", "h2", "old-unread", "recent-read"]);
    expect(
      (await testDb.select().from(notificationDeliveries))
        .map((r) => r.status)
        .sort(),
    ).toEqual(["failed", "pending"]);
    expect(
      (await testDb.select().from(scheduledJobs)).map((r) => r.jobKey).sort(),
    ).toEqual(["cancelled-recent", "scheduled-old"]);
  });

  it("cleanup deletes at most 500 notifications per run", async () => {
    const now = cronAt("2026-11-10");
    const old = new Date(now.getTime() - 100 * DAY_MS).toISOString();
    await testDb.insert(notifications).values(
      Array.from({ length: 502 }, (_, i) => ({
        recipientType: "member" as const,
        recipientId: 1,
        kind: "session_opened",
        payload: {},
        createdAt: old,
        readAt: old,
        dedupKey: `bulk-${i}`,
      })),
    );
    expect((await runDailyNotifications(testDb, now)).cleaned).toBe(500);
    expect(await testDb.select().from(notifications)).toHaveLength(2);
  });
});

describe("runMorningMail", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test");
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("a 23:10 VN email deferred to 07:00 is sent by runMorningMail", async () => {
    const m = await addMember({ email: true });
    await notify(testDb, {
      kind: "payment_confirmed",
      recipients: [{ type: "member", id: m }],
      payload: { amount: 60_000 },
      dedupBase: "paycf:d1:k1",
      now: new Date("2026-11-05T23:10:00+07:00"),
    });
    const [queued] = await testDb.select().from(notificationDeliveries);
    expect(queued.nextAttemptAt).toBe(iso("2026-11-06T07:00:00+07:00"));

    const result = await runMorningMail(
      testDb,
      new Date("2026-11-06T07:00:00+07:00"),
    );
    expect(result.drained).toBe(1);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail.mock.calls[0][0].to).toBe(`m${seq}@example.test`);
  });

  it("digest is sent once per person per day even if the mail cron runs twice", async () => {
    const m = await addMember({ email: true });
    const other = await addMember({ email: false });
    const yesterday = new Date("2026-11-05T15:00:00+07:00");
    // Tin cấp "digest" (không xếp hàng mail riêng).
    await notify(testDb, {
      kind: "venue_approved",
      recipients: [
        { type: "member", id: m },
        { type: "member", id: other },
      ],
      payload: { venueName: "Sân B" },
      dedupBase: "venuest:v1:approved",
      entity: { type: "venue", id: 1 },
      now: yesterday,
    });
    // Mail không bắt buộc bị bỏ vì chạm trần trong ngày: gom vào tóm tắt.
    const capped = await notify(testDb, {
      kind: "vote_due_soon",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-06", startTime: "20:30", hoursLeft: 24 },
      dedupBase: "vdue:s1:24h:fp",
      now: yesterday,
    });
    await testDb
      .update(notificationDeliveries)
      .set({ status: "skipped", errorCode: "daily_cap", attempts: 1 })
      .where(eq(notificationDeliveries.notificationId, capped.ids[0]));
    // Tin đã đọc hoặc quá 24 giờ thì không gom.
    await notify(testDb, {
      kind: "venue_hidden",
      recipients: [{ type: "member", id: m }],
      payload: { venueName: "Sân cũ" },
      dedupBase: "venuest:v2:hidden",
      now: new Date("2026-11-04T15:00:00+07:00"),
    });

    const at7 = new Date("2026-11-06T07:00:00+07:00");
    expect(await runMorningMail(testDb, at7)).toEqual({
      digests: 1,
      drained: 0,
    });
    expect(
      await runMorningMail(testDb, new Date(at7.getTime() + 60_000)),
    ).toEqual({
      digests: 0,
      drained: 0,
    });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const mail = mailer.sendMail.mock.calls[0][0];
    expect(mail.subject).toBe("FWBB: bạn có 2 thông báo mới");
    expect(mail.text).toContain("Sân B");
    expect(mail.text).not.toContain("Sân cũ");

    const [claim] = await testDb
      .select()
      .from(scheduledJobs)
      .where(and(eq(scheduledJobs.kind, "digest")));
    expect(claim).toMatchObject({
      jobKey: `digest:2026-11-06:m${m}`,
      status: "done",
    });
  });

  it("lets a later run retry the digest when sending fails", async () => {
    const m = await addMember({ email: true });
    await notify(testDb, {
      kind: "venue_approved",
      recipients: [{ type: "member", id: m }],
      payload: { venueName: "Sân B" },
      dedupBase: "venuest:v1:approved",
      now: new Date("2026-11-05T15:00:00+07:00"),
    });
    mailer.sendMail.mockResolvedValueOnce({ ok: false, code: "transient" });
    const at7 = new Date("2026-11-06T07:00:00+07:00");
    expect((await runMorningMail(testDb, at7)).digests).toBe(0);
    expect((await runMorningMail(testDb, at7)).digests).toBe(1);
    expect(mailer.sendMail).toHaveBeenCalledTimes(2);
  });
});

describe("ip signal cleanup (G2d)", () => {
  const SECRET = "cron-secret-for-ip-signal-tests";

  async function seedSignals(now: Date) {
    await client.execute("DELETE FROM member_ip_signals");
    const m = await addMember();
    const at = (days: number) =>
      new Date(now.getTime() - days * DAY_MS).toISOString();
    const rows: [string, string][] = [
      ["old-1", at(31)],
      ["old-2", at(90)],
      ["fresh", at(29)],
    ];
    for (const [hash, seen] of rows) {
      await client.execute({
        sql: "INSERT INTO member_ip_signals (member_id, ip_hash, kind, first_seen_at, last_seen_at) VALUES (?, ?, 'login', ?, ?)",
        args: [m, hash, seen, seen],
      });
    }
  }
  const hashes = async () =>
    (
      await client.execute(
        "SELECT ip_hash FROM member_ip_signals ORDER BY ip_hash",
      )
    ).rows.map((r) => String(r.ip_hash));

  beforeEach(async () => {
    await reset();
    vi.stubEnv("CRON_SECRET", SECRET);
  });

  it("with the notifications flag off the daily cron still deletes rows older than 30 days and keeps newer ones", async () => {
    const now = new Date();
    await seedSignals(now);
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/cron/notifications-daily/route");
    const res = await GET(
      new NextRequest("https://fwbb.test/api/cron/notifications-daily", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    // Phản hồi khi tắt thông báo giữ nguyên như cũ.
    expect(await res.json()).toEqual({ skipped: "disabled" });
    expect(await hashes()).toEqual(["fresh"]);

    // Gọi thẳng runDailyNotifications khi tắt cờ cũng dọn trước cổng.
    await seedSignals(now);
    const report = await runDailyNotifications(testDb, now);
    expect(report).toMatchObject({ ipSignalsPruned: 2, errors: [] });
    expect(await hashes()).toEqual(["fresh"]);
    expect(await testDb.select().from(notifications)).toHaveLength(0);
  });

  it("with the flag on the daily step prunes in batches and reports a failure without stopping", async () => {
    await enableNotificationsForTest(testDb);
    const now = cronAt("2026-11-03");
    await seedSignals(now);
    const report = await runDailyNotifications(testDb, now);
    expect(report).toMatchObject({ ipSignalsPruned: 2, errors: [] });
    expect(await hashes()).toEqual(["fresh"]);

    await seedSignals(now);
    await client.execute(
      "CREATE TRIGGER ip_signal_prune_boom BEFORE DELETE ON member_ip_signals BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    try {
      const failed = await runDailyNotifications(testDb, now);
      expect(failed.errors).toEqual([expect.stringMatching(/^ip_signals:/)]);
      expect(failed.reconcileChecked).toBe(true);
    } finally {
      await client.execute("DROP TRIGGER IF EXISTS ip_signal_prune_boom");
    }
  });
});
