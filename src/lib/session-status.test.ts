import { describe, it, expect, vi, afterEach } from "vitest";
import { isVoteOpen, deriveSessionBadge } from "./session-status";

describe("deriveSessionBadge", () => {
  const today = "2026-06-15";

  it("voting + future/today date → live voting, voting variant", () => {
    expect(deriveSessionBadge("voting", "2026-06-15", today)).toEqual({
      variant: "voting",
      labelKey: "voting",
      isPastPending: false,
      isVoting: true,
    });
  });

  it("voting + past date → needsConfirm variant, not LED", () => {
    expect(deriveSessionBadge("voting", "2026-06-10", today)).toEqual({
      variant: "needsConfirm",
      labelKey: "voting",
      isPastPending: true,
      isVoting: false,
    });
  });

  it("confirmed + past date → needsConfirm (admin chưa chốt)", () => {
    const b = deriveSessionBadge("confirmed", "2026-06-10", today);
    expect(b.variant).toBe("needsConfirm");
    expect(b.isPastPending).toBe(true);
    expect(b.isVoting).toBe(false);
  });

  it("completed/cancelled → own variant, never past-pending", () => {
    expect(deriveSessionBadge("completed", "2026-06-10", today)).toMatchObject({
      variant: "completed",
      isPastPending: false,
      isVoting: false,
    });
    expect(deriveSessionBadge("cancelled", "2026-06-10", today)).toMatchObject({
      variant: "cancelled",
      isPastPending: false,
    });
  });

  it("null/unknown status falls back to voting", () => {
    expect(deriveSessionBadge(null, today, today).labelKey).toBe("voting");
    expect(deriveSessionBadge("weird", today, today).variant).toBe("voting");
  });
});

// voteDeadline is a VN wall-clock string (no offset). isVoteOpen must interpret
// it as +07:00, NOT the runtime local TZ — the Vercel server runs UTC. These
// tests fix the system clock in UTC and use explicit VN deadlines so they assert
// the correct timezone framing regardless of the machine running the suite.
describe("isVoteOpen", () => {
  afterEach(() => vi.useRealTimers());

  // Freeze "now" at 2026-05-21 10:00Z == 17:00 VN.
  function nowAtUtc(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  // 20:00 VN (13:00Z) is after 17:00 VN → future; 16:00 VN (09:00Z) → past.
  const futureVN = "2026-05-21T20:00:00";
  const pastVN = "2026-05-21T16:00:00";

  it("returns open=true when status=voting and deadline in future", () => {
    nowAtUtc("2026-05-21T10:00:00Z");
    expect(isVoteOpen({ status: "voting", voteDeadline: futureVN })).toEqual({
      open: true,
    });
  });

  it("returns open=true when status=confirmed and deadline in future", () => {
    nowAtUtc("2026-05-21T10:00:00Z");
    expect(isVoteOpen({ status: "confirmed", voteDeadline: futureVN })).toEqual(
      {
        open: true,
      },
    );
  });

  it("returns open=true when deadline is null (no deadline)", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: null })).toEqual({
      open: true,
    });
  });

  it("returns open=false reason=deadline when status=voting and deadline in past", () => {
    nowAtUtc("2026-05-21T10:00:00Z");
    expect(isVoteOpen({ status: "voting", voteDeadline: pastVN })).toEqual({
      open: false,
      reason: "deadline",
    });
  });

  it("interprets the deadline as VN time, not UTC (regression: was ~7h late)", () => {
    // 09:45Z == 16:45 VN, just past a 16:30 VN deadline. A bare UTC parse would
    // read the deadline as 16:30Z and wrongly keep voting open until 16:30Z.
    nowAtUtc("2026-05-21T09:45:00Z");
    expect(
      isVoteOpen({ status: "voting", voteDeadline: "2026-05-21T16:30:00" }),
    ).toEqual({ open: false, reason: "deadline" });
    // Sanity: at 09:15Z (16:15 VN) the same deadline is still open.
    nowAtUtc("2026-05-21T09:15:00Z");
    expect(
      isVoteOpen({ status: "voting", voteDeadline: "2026-05-21T16:30:00" }),
    ).toEqual({ open: true });
  });

  it("returns open=false reason=status when status=completed (regardless of deadline)", () => {
    nowAtUtc("2026-05-21T10:00:00Z");
    expect(isVoteOpen({ status: "completed", voteDeadline: futureVN })).toEqual(
      {
        open: false,
        reason: "status",
      },
    );
  });

  it("returns open=false reason=status when status=cancelled and deadline null", () => {
    expect(isVoteOpen({ status: "cancelled", voteDeadline: null })).toEqual({
      open: false,
      reason: "status",
    });
  });

  it("status check fires before deadline check (completed + past deadline → reason=status)", () => {
    nowAtUtc("2026-05-21T10:00:00Z");
    expect(isVoteOpen({ status: "completed", voteDeadline: pastVN })).toEqual({
      open: false,
      reason: "status",
    });
  });
});
