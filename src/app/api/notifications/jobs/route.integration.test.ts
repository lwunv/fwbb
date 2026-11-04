import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { createTestDb } from "@/db/test-db";
import { scheduledJobs } from "@/db/schema";
import { enableNotificationsForTest } from "@/lib/notifications/test-helpers";

const APP_URL = "https://fwbb.test";
const TARGET = `${APP_URL}/api/notifications/jobs`;
const CURRENT_KEY = "sig_current_key_for_tests";
const NEXT_KEY = "sig_next_key_for_tests";
process.env.NEXT_PUBLIC_APP_URL = APP_URL;
process.env.QSTASH_TOKEN = "qstash-token";
process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
process.env.QSTASH_NEXT_SIGNING_KEY = NEXT_KEY;

const { db: testDb, client } = await createTestDb();
// Đếm mỗi lần route chạm tới DB, để chứng minh chữ ký được kiểm trước.
const dbTouches = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/db", () => ({
  get db() {
    dbTouches.n++;
    return testDb;
  },
}));

const runJob = vi.hoisted(() =>
  vi.fn<() => Promise<"done" | "skipped">>(async () => "done"),
);
vi.mock("@/lib/notifications/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/jobs")>()),
  runJob,
}));

const route = await import("./route");
const { POST } = route;

const RUN_AT = "2026-11-07T07:30:00.000Z";
const JOB_KEY = "vote_due_2h:s1:abcd1234";

async function sign(body: string, key = CURRENT_KEY, sub = TARGET) {
  const hash = createHash("sha256").update(body).digest("base64url");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ body: hash })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("Upstash")
    .setSubject(sub)
    .setIssuedAt(now)
    .setNotBefore(now - 5)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(key));
}

function request(body: string, signature?: string) {
  return new NextRequest(TARGET, {
    method: "POST",
    body,
    headers: signature ? { "upstash-signature": signature } : {},
  });
}

const bodyFor = (runAt = RUN_AT, jobKey = JOB_KEY) =>
  JSON.stringify({ jobKey, runAt });

async function addJob(runAt = RUN_AT) {
  const now = new Date().toISOString();
  await testDb.insert(scheduledJobs).values({
    jobKey: JOB_KEY,
    kind: "vote_due_2h",
    sessionId: 1,
    runAt,
    status: "scheduled",
    messageId: "msg-1",
    createdAt: now,
    updatedAt: now,
  });
}

async function jobStatus() {
  const [row] = await testDb
    .select({ status: scheduledJobs.status })
    .from(scheduledJobs);
  return row?.status;
}

describe("POST /api/notifications/jobs", () => {
  beforeEach(async () => {
    await client.execute("DELETE FROM scheduled_jobs");
    await client.execute("DELETE FROM app_settings");
    await enableNotificationsForTest(testDb);
    await addJob();
    runJob.mockClear();
    dbTouches.n = 0;
  });

  it("route rejects a missing or forged signature with 401 before touching the DB", async () => {
    const body = bodyFor();
    const cases = [
      request(body),
      request(body, await sign(body, "wrong-key")),
      // Chữ ký thật nhưng cho body khác.
      request(body, await sign(bodyFor("2026-11-08T07:30:00.000Z"))),
      // Chữ ký thật nhưng cho URL đích khác.
      request(body, await sign(body, CURRENT_KEY, "https://evil.test/x")),
    ];
    for (const req of cases) {
      const res = await POST(req);
      expect(res.status).toBe(401);
    }
    expect(dbTouches.n).toBe(0);
    expect(runJob).not.toHaveBeenCalled();
    expect(await jobStatus()).toBe("scheduled");
  });

  it("accepts a signature made with the next signing key", async () => {
    const body = bodyFor();
    const res = await POST(request(body, await sign(body, NEXT_KEY)));
    expect(res.status).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("route runs a scheduled job once; a second delivery is a noop; a message carrying an old runAt is a noop", async () => {
    // Message của lần hẹn trước (runAt cũ): không chạy.
    const stale = bodyFor("2026-11-07T06:30:00.000Z");
    const r0 = await POST(request(stale, await sign(stale)));
    expect(r0.status).toBe(200);
    expect(runJob).not.toHaveBeenCalled();
    expect(await jobStatus()).toBe("scheduled");

    const body = bodyFor();
    const r1 = await POST(request(body, await sign(body)));
    expect(r1.status).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(await jobStatus()).toBe("done");

    const r2 = await POST(request(body, await sign(body)));
    expect(r2.status).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);

    // Job không tồn tại: noop.
    const unknown = bodyFor(RUN_AT, "day_3h:s9:ffffffff");
    const r3 = await POST(request(unknown, await sign(unknown)));
    expect(r3.status).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("stores skipped when the job has nothing to do", async () => {
    runJob.mockResolvedValueOnce("skipped");
    const body = bodyFor();
    await POST(request(body, await sign(body)));
    expect(await jobStatus()).toBe("skipped");
  });

  it("returns 500 when the job fails so QStash retries", async () => {
    runJob.mockRejectedValueOnce(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = bodyFor();
    const res = await POST(request(body, await sign(body)));
    expect(res.status).toBe(500);
    expect(await jobStatus()).toBe("scheduled");
    err.mockRestore();
  });

  it("switch off: returns 200 skipped without running the job", async () => {
    await client.execute("DELETE FROM app_settings");
    const body = bodyFor();
    const res = await POST(request(body, await sign(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "disabled" });
    expect(runJob).not.toHaveBeenCalled();
    expect(await jobStatus()).toBe("scheduled");
  });

  it("allows 60 s like the cron routes (an outbox_retry drains up to 50 mails)", () => {
    expect(route.maxDuration).toBe(60);
  });
});
