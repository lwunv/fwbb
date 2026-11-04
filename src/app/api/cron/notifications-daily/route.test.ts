import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/db/test-db";
import { enableNotificationsForTest } from "@/lib/notifications/test-helpers";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const daily = vi.hoisted(() => ({
  runDailyNotifications: vi.fn(async () => ({
    opened: 0,
    jobsRun: 0,
    rescheduled: 0,
    debtReminders: 2,
    drained: 0,
    rentChecked: false,
    reconcileChecked: true,
    cleaned: 0,
    errors: [],
  })),
  runMorningMail: vi.fn(async () => ({ digests: 1, drained: 3 })),
}));
vi.mock("@/lib/notifications/daily", () => daily);

const dailyRoute = await import("./route");
const mailRoute = await import("../notifications-mail/route");

const SECRET = "cron-secret-for-tests";
const request = (path: string, auth?: string) =>
  new NextRequest(`https://fwbb.test${path}`, {
    headers: auth ? { authorization: auth } : {},
  });

describe.each([
  {
    name: "notifications-daily",
    GET: dailyRoute.GET,
    path: "/api/cron/notifications-daily",
    run: daily.runDailyNotifications,
    report: { debtReminders: 2, reconcileChecked: true },
  },
  {
    name: "notifications-mail",
    GET: mailRoute.GET,
    path: "/api/cron/notifications-mail",
    run: daily.runMorningMail,
    report: { digests: 1, drained: 3 },
  },
])("route: $name", ({ GET, path, run, report }) => {
  beforeEach(async () => {
    await client.execute("DELETE FROM app_settings");
    vi.stubEnv("CRON_SECRET", SECRET);
    run.mockClear();
  });

  it("route: missing CRON_SECRET → 500, wrong bearer → 401, switch off → skipped", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(path, `Bearer ${SECRET}`))).status).toBe(500);

    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await GET(request(path, "Bearer nope"))).status).toBe(401);
    expect((await GET(request(path))).status).toBe(401);

    const off = await GET(request(path, `Bearer ${SECRET}`));
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ skipped: "disabled" });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs and returns the report when the switch is on", async () => {
    await enableNotificationsForTest(testDb);
    const res = await GET(request(path, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(report);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("allows up to 60 seconds", () => {
    expect(dailyRoute.maxDuration).toBe(60);
    expect(mailRoute.maxDuration).toBe(60);
  });
});
