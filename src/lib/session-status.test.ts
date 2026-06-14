import { describe, it, expect } from "vitest";
import { isVoteOpen, deriveSessionBadge } from "./session-status";
import { formatLocalDeadline } from "./vote-deadline";

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

// Use the same local-time-no-Z format the production code stores (matches
// integration tests + DB rows). Comparison in isVoteOpen is absolute-ms so
// either format would pass — using local format is cosmetic consistency.
describe("isVoteOpen", () => {
  const future = formatLocalDeadline(new Date(Date.now() + 60 * 60 * 1000));
  const past = formatLocalDeadline(new Date(Date.now() - 60 * 60 * 1000));

  it("returns open=true when status=voting and deadline in future", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: future })).toEqual({
      open: true,
    });
  });

  it("returns open=true when status=confirmed and deadline in future", () => {
    expect(isVoteOpen({ status: "confirmed", voteDeadline: future })).toEqual({
      open: true,
    });
  });

  it("returns open=true when deadline is null (no deadline)", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: null })).toEqual({
      open: true,
    });
  });

  it("returns open=false reason=deadline when status=voting and deadline in past", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: past })).toEqual({
      open: false,
      reason: "deadline",
    });
  });

  it("returns open=false reason=status when status=completed (regardless of deadline)", () => {
    expect(isVoteOpen({ status: "completed", voteDeadline: future })).toEqual({
      open: false,
      reason: "status",
    });
  });

  it("returns open=false reason=status when status=cancelled and deadline null", () => {
    expect(isVoteOpen({ status: "cancelled", voteDeadline: null })).toEqual({
      open: false,
      reason: "status",
    });
  });

  it("status check fires before deadline check (completed + past deadline → reason=status)", () => {
    expect(isVoteOpen({ status: "completed", voteDeadline: past })).toEqual({
      open: false,
      reason: "status",
    });
  });
});
