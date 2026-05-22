import { describe, it, expect } from "vitest";
import { isVoteOpen } from "./session-status";
import { formatLocalDeadline } from "./vote-deadline";

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
