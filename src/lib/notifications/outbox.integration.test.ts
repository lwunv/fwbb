import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  admins,
  members,
  notificationDeliveries,
  notifications,
} from "@/db/schema";
import type { MailMessage, MailOutcome } from "@/lib/mailer";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const mailer = vi.hoisted(() => ({
  sendMail: vi.fn<(msg: MailMessage) => Promise<MailOutcome>>(),
}));
vi.mock("@/lib/mailer", () => mailer);

const { notify } = await import("./notify");
const { drainOutbox, getLastEmailFailure } = await import("./outbox");
const { enableNotificationsForTest } = await import("./test-helpers");

// 10:00 VN, ngoài giờ yên lặng.
const DAY = new Date("2026-11-10T10:00:00+07:00");
const min = (n: number) => n * 60_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

async function reset() {
  for (const t of [
    "notification_deliveries",
    "notifications",
    "notification_prefs",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  mailer.sendMail.mockReset();
  mailer.sendMail.mockResolvedValue({ ok: true });
}

let seq = 0;
async function addMember(opts: { verified?: boolean } = {}) {
  seq++;
  const email = `m${seq}@example.test`;
  const [m] = await testDb
    .insert(members)
    .values({
      name: `M${seq}`,
      facebookId: `fb-${seq}`,
      email,
      notifyEmailVerifiedFor: opts.verified === false ? null : email,
    })
    .returning({ id: members.id });
  return m.id;
}

async function addSuperadmin(email: string | null) {
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

async function notifyPassword(memberId: number, now = DAY) {
  return notify(testDb, {
    kind: "password_changed",
    recipients: [{ type: "member", id: memberId }],
    payload: {},
    dedupBase: `pwd:m${memberId}:${seq++}`,
    now,
  });
}

async function deliveries() {
  return testDb
    .select()
    .from(notificationDeliveries)
    .orderBy(notificationDeliveries.id);
}

describe("email outbox", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test");
    await reset();
    await enableNotificationsForTest(testDb);
  });

  it("notify queues an email only for eligible recipients of email kinds", async () => {
    const verified = await addMember();
    const unverified = await addMember({ verified: false });
    await notify(testDb, {
      kind: "session_cancelled",
      recipients: [
        { type: "member", id: verified },
        { type: "member", id: unverified },
      ],
      payload: { sessionDate: "2026-11-12", startTime: "20:00" },
      dedupBase: "scancel:s1:t1",
      now: DAY,
    });
    // session_opened không có email.
    await notify(testDb, {
      kind: "session_opened",
      recipients: [{ type: "member", id: verified }],
      payload: { sessionDate: "2026-11-12", startTime: "20:00" },
      dedupBase: "sopen:s1",
      now: DAY,
    });
    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientType: "member",
      recipientId: verified,
      channel: "email",
      status: "pending",
      attempts: 0,
      nextAttemptAt: DAY.toISOString(),
    });
  });

  it("quiet hours: 23:10 VN defers to 07:00 VN; same-day cancellation bypasses", async () => {
    const m = await addMember();
    const late = new Date("2026-11-10T23:10:00+07:00");
    // Buổi ngày mai: dồn tới 07:00 sáng mai.
    await notify(testDb, {
      kind: "session_cancelled",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-11", startTime: "20:00" },
      dedupBase: "scancel:s1:t1",
      now: late,
    });
    // Buổi diễn ra trong hôm nay (VN): gửi ngay.
    await notify(testDb, {
      kind: "session_cancelled",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-10", startTime: "23:30" },
      dedupBase: "scancel:s2:t1",
      now: late,
    });
    // Kind không vượt giờ yên lặng: dồn dù buổi trong hôm nay.
    await notify(testDb, {
      kind: "session_finalized",
      recipients: [{ type: "member", id: m }],
      payload: {
        sessionDate: "2026-11-10",
        startTime: "20:00",
        playAmount: 50_000,
        dineAmount: 0,
        guestPlayAmount: 0,
        guestDineAmount: 0,
        guestToFund: 0,
        total: 50_000,
        balance: -50_000,
      },
      dedupBase: "fin:s3:n1",
      now: late,
    });
    const rows = await deliveries();
    const morning = new Date("2026-11-11T07:00:00+07:00").toISOString();
    expect(rows.map((r) => r.nextAttemptAt)).toEqual([
      morning,
      late.toISOString(),
      morning,
    ]);

    const r = await drainOutbox(testDb, { now: at(late, min(1)) });
    expect(r).toEqual({ sent: 1, failed: 0, deferred: 0, skipped: 0 });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
  });

  it("quiet hours: a cancellation for a session that starts before 07:00 VN sends now; one two days out is deferred", async () => {
    const m = await addMember();
    const late = new Date("2026-11-10T23:10:00+07:00");
    // Buổi 06:00 sáng mai: dồn tới 07:00 là quá giờ chơi, phải gửi ngay.
    await notify(testDb, {
      kind: "session_cancelled",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-11", startTime: "06:00" },
      dedupBase: "scancel:s1:t1",
      now: late,
    });
    // Buổi ngày kia: chờ tới 07:00 sáng mai.
    await notify(testDb, {
      kind: "session_cancelled",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-12", startTime: "06:00" },
      dedupBase: "scancel:s2:t1",
      now: late,
    });
    const rows = await deliveries();
    expect(rows.map((r) => r.nextAttemptAt)).toEqual([
      late.toISOString(),
      new Date("2026-11-11T07:00:00+07:00").toISOString(),
    ]);
  });

  it("two concurrent drains send each delivery once", async () => {
    for (let i = 0; i < 3; i++) await notifyPassword(await addMember());
    const [a, b] = await Promise.all([
      drainOutbox(testDb, { now: DAY }),
      drainOutbox(testDb, { now: DAY }),
    ]);
    expect(a.sent + b.sent).toBe(3);
    expect(mailer.sendMail).toHaveBeenCalledTimes(3);
    const tos = mailer.sendMail.mock.calls.map(([msg]) => msg.to).sort();
    expect(new Set(tos).size).toBe(3);
    expect((await deliveries()).every((d) => d.status === "sent")).toBe(true);
  });

  it("drain A claims and is held inside sendMail; drain B runs to completion; A resumes: sendMail called exactly once", async () => {
    await notifyPassword(await addMember());
    let release!: (v: MailOutcome) => void;
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    mailer.sendMail.mockImplementationOnce(
      () =>
        new Promise<MailOutcome>((resolve) => {
          release = resolve;
          entered();
        }),
    );

    const drainA = drainOutbox(testDb, { now: DAY });
    await inside;
    // B chạy sau khi A đã giữ chỗ, kể cả muộn hơn vài phút (còn trong lease).
    const b = await drainOutbox(testDb, { now: at(DAY, min(5)) });
    expect(b).toEqual({ sent: 0, failed: 0, deferred: 0, skipped: 0 });
    release({ ok: true });
    const a = await drainA;

    expect(a.sent).toBe(1);
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const [d] = await deliveries();
    expect(d).toMatchObject({ status: "sent", attempts: 1 });
    expect(d.sentAt).not.toBeNull();
  });

  it("a send that crashed mid-way is retried after the lease expires", async () => {
    await notifyPassword(await addMember());
    // Giả lập lượt drain chết sau khi giữ chỗ: lease đã đặt, không ai kết thúc.
    await client.execute(
      `UPDATE notification_deliveries SET attempts = 1, next_attempt_at = '${at(DAY, min(10)).toISOString()}'`,
    );
    expect((await drainOutbox(testDb, { now: at(DAY, min(9)) })).sent).toBe(0);
    expect((await drainOutbox(testDb, { now: at(DAY, min(10)) })).sent).toBe(1);
    const [d] = await deliveries();
    expect(d).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("transient failure retries with backoff and fails after 5 attempts; permanent fails at once", async () => {
    await notifyPassword(await addMember());
    mailer.sendMail.mockResolvedValue({ ok: false, code: "transient" });

    let t = DAY;
    for (const wait of [5, 30, 120, 720]) {
      const r = await drainOutbox(testDb, { now: t });
      expect(r).toEqual({ sent: 0, failed: 0, deferred: 1, skipped: 0 });
      const [d] = await deliveries();
      expect(d.status).toBe("pending");
      expect(d.errorCode).toBe("transient");
      expect(d.nextAttemptAt).toBe(at(t, min(wait)).toISOString());
      // Chưa tới giờ thử lại: không gửi.
      expect(
        (await drainOutbox(testDb, { now: at(t, min(wait) - 1000) })).deferred,
      ).toBe(0);
      t = at(t, min(wait));
    }
    const last = await drainOutbox(testDb, { now: t });
    expect(last).toEqual({ sent: 0, failed: 1, deferred: 0, skipped: 0 });
    const [d] = await deliveries();
    expect(d).toMatchObject({
      status: "failed",
      attempts: 5,
      errorCode: "transient",
    });
    expect(mailer.sendMail).toHaveBeenCalledTimes(5);

    // permanent: thất bại ngay ở lần đầu.
    await notifyPassword(await addMember());
    mailer.sendMail.mockResolvedValue({ ok: false, code: "permanent" });
    const later = at(t, min(1));
    expect(await drainOutbox(testDb, { now: later })).toEqual({
      sent: 0,
      failed: 1,
      deferred: 0,
      skipped: 0,
    });
    const rows = await deliveries();
    expect(rows[1]).toMatchObject({
      status: "failed",
      attempts: 1,
      errorCode: "permanent",
    });
    expect(await getLastEmailFailure(testDb)).toEqual({
      at: later.toISOString(),
      errorCode: "permanent",
    });
  });

  it("not_configured fails at once and is reported as the last failure", async () => {
    expect(await getLastEmailFailure(testDb)).toBeNull();
    await notifyPassword(await addMember());
    mailer.sendMail.mockResolvedValue({ ok: false, code: "not_configured" });
    expect((await drainOutbox(testDb, { now: DAY })).failed).toBe(1);
    expect(await getLastEmailFailure(testDb)).toEqual({
      at: DAY.toISOString(),
      errorCode: "not_configured",
    });
  });

  it("seventh optional email of the day is skipped with daily_cap; mandatory still sends", async () => {
    const m = await addMember();
    for (let i = 1; i <= 7; i++) {
      await notify(testDb, {
        kind: "vote_due_soon",
        recipients: [{ type: "member", id: m }],
        payload: {
          sessionDate: "2026-11-1" + i,
          startTime: "20:00",
          hoursLeft: 24,
        },
        dedupBase: `vdue:s${i}:24h:fp`,
        now: at(DAY, min(i)),
      });
    }
    await notifyPassword(m, at(DAY, min(8)));

    const r = await drainOutbox(testDb, { now: at(DAY, min(10)) });
    expect(r).toEqual({ sent: 7, failed: 0, deferred: 0, skipped: 1 });

    const rows = await testDb
      .select({
        status: notificationDeliveries.status,
        errorCode: notificationDeliveries.errorCode,
        kind: notifications.kind,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notifications,
        eq(notifications.id, notificationDeliveries.notificationId),
      )
      .orderBy(notificationDeliveries.id);
    expect(rows.filter((x) => x.status === "skipped")).toEqual([
      { status: "skipped", errorCode: "daily_cap", kind: "vote_due_soon" },
    ]);
    expect(rows.find((x) => x.kind === "password_changed")?.status).toBe(
      "sent",
    );
    // Tin vẫn ở chuông.
    expect(await testDb.select().from(notifications)).toHaveLength(8);

    // Ngày VN mới: trần đếm lại từ đầu.
    await notify(testDb, {
      kind: "vote_due_soon",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-20", startTime: "20:00", hoursLeft: 24 },
      dedupBase: "vdue:s20:24h:fp",
      now: at(DAY, 24 * min(60)),
    });
    expect(
      (await drainOutbox(testDb, { now: at(DAY, 24 * min(60)) })).sent,
    ).toBe(1);
  });

  it("optional mail carries one-click unsubscribe headers; mandatory mail does not", async () => {
    const m = await addMember();
    await notify(testDb, {
      kind: "vote_due_soon",
      recipients: [{ type: "member", id: m }],
      payload: { sessionDate: "2026-11-11", startTime: "20:00", hoursLeft: 24 },
      dedupBase: "vdue:s1:24h:fp",
      now: DAY,
    });
    await notifyPassword(m);
    await drainOutbox(testDb, { now: DAY });

    const byText = mailer.sendMail.mock.calls.map(([msg]) => msg);
    const optional = byText.find((x) => x.headers);
    const mandatory = byText.find((x) => !x.headers);
    expect(optional?.headers?.["List-Unsubscribe-Post"]).toBe(
      "List-Unsubscribe=One-Click",
    );
    expect(optional?.headers?.["List-Unsubscribe"]).toMatch(
      /^<https:\/\/fwbb\.test\/api\/notifications\/unsubscribe\?token=[\w-]+>$/,
    );
    expect(optional?.text).toContain(
      "https://fwbb.test/huy-nhan-thong-bao?token=",
    );
    expect(mandatory).toBeDefined();
    expect(mandatory?.text).not.toContain("huy-nhan-thong-bao");
    expect(mandatory?.text).toContain("https://fwbb.test/me");
  });

  it("member who removed their email before send is skipped", async () => {
    const m = await addMember();
    await notifyPassword(m);
    await testDb.update(members).set({ email: null }).where(eq(members.id, m));
    expect(await drainOutbox(testDb, { now: DAY })).toEqual({
      sent: 0,
      failed: 0,
      deferred: 0,
      skipped: 1,
    });
    expect(mailer.sendMail).not.toHaveBeenCalled();
    const [d] = await deliveries();
    expect(d.status).toBe("skipped");
  });

  it("admins with an email are queued; drain sends to the admin address", async () => {
    const admin = await addSuperadmin("boss@example.test");
    await addSuperadmin(null);
    await notify(testDb, {
      kind: "reconcile_failed",
      recipients: [{ type: "admin", id: admin }],
      payload: { errorCount: 2 },
      dedupBase: "reconcile:2026-11-10",
      now: DAY,
    });
    await drainOutbox(testDb, { now: DAY });
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail.mock.calls[0][0].to).toBe("boss@example.test");
    expect(mailer.sendMail.mock.calls[0][0].text).toContain(
      "https://fwbb.test/admin/account",
    );
  });

  it("drain does nothing while notificationsEnabled is off", async () => {
    await notifyPassword(await addMember());
    await client.execute("DELETE FROM app_settings");
    expect(await drainOutbox(testDb, { now: DAY })).toEqual({
      sent: 0,
      failed: 0,
      deferred: 0,
      skipped: 0,
    });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("drain with ids only touches those deliveries", async () => {
    await notifyPassword(await addMember());
    await notifyPassword(await addMember());
    const [first] = await deliveries();
    const r = await drainOutbox(testDb, { ids: [first.id], now: DAY });
    expect(r.sent).toBe(1);
    const rows = await deliveries();
    expect(rows.map((d) => d.status)).toEqual(["sent", "pending"]);
  });
});
