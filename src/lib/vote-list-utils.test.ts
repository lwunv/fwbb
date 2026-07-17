import { describe, it, expect } from "vitest";
import {
  attendingVotesCount,
  attendingHeadCount,
  countVoteParticipation,
} from "./vote-list-utils";

describe("attendingVotesCount", () => {
  it("counts votes that attend at least one activity", () => {
    expect(
      attendingVotesCount([
        { willPlay: true, willDine: false },
        { willPlay: false, willDine: true },
        { willPlay: false, willDine: false },
        { willPlay: true, willDine: true },
      ]),
    ).toBe(3);
  });
});

describe("attendingHeadCount", () => {
  it("counts đi-2-người as 2, solo as 1, non-attending as 0", () => {
    expect(
      attendingHeadCount([
        { willPlay: true, willDine: false, withPartner: true }, // 2
        { willPlay: false, willDine: true, withPartner: true }, // 2 (dine + partner)
        { willPlay: true, willDine: false, withPartner: false }, // 1
        { willPlay: false, willDine: false, withPartner: true }, // 0 (không tham gia)
      ]),
    ).toBe(5);
  });

  it("treats missing withPartner as solo (1)", () => {
    expect(attendingHeadCount([{ willPlay: true }, { willDine: true }])).toBe(
      2,
    );
  });
});

describe("countVoteParticipation", () => {
  it("returns all zeros for empty votes", () => {
    expect(countVoteParticipation([])).toEqual({
      memberPlay: 0,
      memberDine: 0,
      partnerPlay: 0,
      partnerDine: 0,
      guestPlay: 0,
      guestDine: 0,
      totalPlayers: 0,
      totalDiners: 0,
    });
  });

  it("counts members + guests for play and dine separately", () => {
    const result = countVoteParticipation([
      { willPlay: true, willDine: true, guestPlayCount: 2, guestDineCount: 1 },
      { willPlay: true, willDine: false, guestPlayCount: 0, guestDineCount: 0 },
      { willPlay: false, willDine: true, guestPlayCount: 1, guestDineCount: 3 },
    ]);
    expect(result).toEqual({
      memberPlay: 2,
      memberDine: 2,
      partnerPlay: 0,
      partnerDine: 0,
      guestPlay: 3,
      guestDine: 4,
      totalPlayers: 5, // 2 members + 3 guests
      totalDiners: 6, // 2 members + 4 guests
    });
  });

  it("treats null/undefined guest counts as 0", () => {
    const result = countVoteParticipation([
      {
        willPlay: true,
        willDine: true,
        guestPlayCount: null,
        guestDineCount: undefined,
      },
      { willPlay: true },
    ]);
    expect(result.guestPlay).toBe(0);
    expect(result.guestDine).toBe(0);
    expect(result.totalPlayers).toBe(2);
    expect(result.totalDiners).toBe(1);
  });
});
