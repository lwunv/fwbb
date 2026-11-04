/**
 * Phần thuần của lịch nhắc theo buổi. Server Vercel chạy UTC, nên ghim TZ=UTC
 * để chắc mọi mốc được tính theo giờ VN rõ ràng chứ không theo múi giờ máy.
 */
process.env.TZ = "UTC";

import { afterAll, describe, expect, it } from "vitest";
import { desiredSessionJobs, sessionFingerprint } from "./jobs";

afterAll(() => {
  delete process.env.TZ;
});

const SESSION = {
  id: 7,
  date: "2026-11-07",
  startTime: "20:30",
  voteDeadline: "2026-11-07T16:30:00",
  status: "voting" as const,
};
const SETTINGS = { courtLockHoursBefore: 4 };
// 2026-11-05 09:00 VN: mọi mốc của buổi còn ở tương lai.
const NOW = new Date("2026-11-05T09:00:00+07:00");

const byKind = (jobs: ReturnType<typeof desiredSessionJobs>) =>
  Object.fromEntries(jobs.map((j) => [j.kind, j]));

describe("sessionFingerprint", () => {
  it("is 8 hex chars and ignores status", () => {
    const fp = sessionFingerprint(SESSION);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(sessionFingerprint({ ...SESSION, voteDeadline: null })).not.toBe(fp);
  });
});

describe("desiredSessionJobs", () => {
  it("desiredSessionJobs computes VN instants", () => {
    const jobs = byKind(desiredSessionJobs(SESSION, SETTINGS, NOW));
    expect(jobs.vote_due_24h.runAt.toISOString()).toBe(
      "2026-11-06T09:30:00.000Z",
    );
    expect(jobs.vote_due_2h.runAt.toISOString()).toBe(
      "2026-11-07T07:30:00.000Z",
    );
    // Mốc giữ sân = 20:30 - 4h = 16:30 VN (trùng hạn vote).
    expect(jobs.court_lock.runAt.toISOString()).toBe(
      "2026-11-07T09:30:00.000Z",
    );
    expect(jobs.day_morning.runAt.toISOString()).toBe(
      "2026-11-07T01:00:00.000Z",
    );
    expect(jobs.day_3h.runAt.toISOString()).toBe("2026-11-07T10:30:00.000Z");

    const fp = sessionFingerprint(SESSION);
    expect(jobs.vote_due_2h.jobKey).toBe(`vote_due_2h:s7:${fp}`);
    expect(jobs.court_lock.jobKey).toBe(`court_lock:s7:h4:${fp}`);
  });

  it("drops jobs that are not in the future and the vote jobs without a deadline", () => {
    // 2026-11-07 15:00 VN: chỉ còn mốc 3h trước giờ chơi (17:30) và giữ sân (16:30).
    const late = new Date("2026-11-07T15:00:00+07:00");
    expect(
      desiredSessionJobs(SESSION, SETTINGS, late).map((j) => j.kind),
    ).toEqual(["court_lock", "day_3h"]);

    const noDeadline = desiredSessionJobs(
      { ...SESSION, voteDeadline: null },
      SETTINGS,
      NOW,
    ).map((j) => j.kind);
    expect(noDeadline).toEqual(["court_lock", "day_morning", "day_3h"]);
  });

  it("changing the start time changes every jobKey; cancelled session wants no jobs; confirmSession changes no jobKey", () => {
    const keys = (s: Parameters<typeof desiredSessionJobs>[0]) =>
      desiredSessionJobs(s, SETTINGS, NOW).map((j) => j.jobKey);
    const before = keys(SESSION);
    const after = keys({ ...SESSION, startTime: "19:00" });
    expect(after).toHaveLength(before.length);
    for (const k of after) expect(before).not.toContain(k);

    expect(keys({ ...SESSION, status: "cancelled" })).toEqual([]);
    expect(keys({ ...SESSION, status: "completed" })).toEqual([]);
    expect(keys({ ...SESSION, status: "confirmed" })).toEqual(before);
  });

  it("changing courtLockHoursBefore changes only the court_lock jobKey", () => {
    const a = byKind(desiredSessionJobs(SESSION, SETTINGS, NOW));
    const b = byKind(
      desiredSessionJobs(SESSION, { courtLockHoursBefore: 6 }, NOW),
    );
    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const kind of Object.keys(a)) {
      if (kind === "court_lock") {
        expect(b[kind].jobKey).not.toBe(a[kind].jobKey);
      } else {
        expect(b[kind].jobKey).toBe(a[kind].jobKey);
      }
    }
  });
});
