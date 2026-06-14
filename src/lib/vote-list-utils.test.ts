import { describe, it, expect } from "vitest";
import {
  attendingVotesCount,
  countVoteParticipation,
  floorableGuestPlayCount,
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

describe("countVoteParticipation", () => {
  it("returns all zeros for empty votes", () => {
    expect(countVoteParticipation([])).toEqual({
      memberPlay: 0,
      memberDine: 0,
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

describe("floorableGuestPlayCount", () => {
  const adminMemberId = 1;
  const votes = [
    { member: { id: 1 }, willPlay: true, guestPlayCount: 5 }, // admin → excluded
    { member: { id: 2 }, willPlay: true, guestPlayCount: 2 }, // member
    { member: { id: 3 }, willPlay: false, guestPlayCount: 3 }, // non-playing host: still counts
    { member: { id: 4 }, willPlay: true, guestPlayCount: 4 }, // exempt → excluded
    { member: { id: 5 }, willPlay: true, guestPlayCount: 0 },
  ];

  it("sums guestPlayCount only for non-admin, non-exempt hosts", () => {
    expect(
      floorableGuestPlayCount(votes, {
        adminMemberId,
        exemptMemberIds: [4],
      }),
    ).toBe(5); // member 2 (2) + member 3 (3); admin & exempt excluded
  });

  it("counts guests of non-playing hosts (matches finalize via invitedById)", () => {
    expect(
      floorableGuestPlayCount(
        [{ member: { id: 9 }, willPlay: false, guestPlayCount: 7 }],
        {
          adminMemberId: 1,
          exemptMemberIds: [],
        },
      ),
    ).toBe(7);
  });

  it("excludes the admin's own guest play", () => {
    expect(
      floorableGuestPlayCount(
        [{ member: { id: 1 }, willPlay: true, guestPlayCount: 8 }],
        {
          adminMemberId: 1,
          exemptMemberIds: [],
        },
      ),
    ).toBe(0);
  });

  it("with adminMemberId null, no admin exclusion (member guests only by data model)", () => {
    expect(
      floorableGuestPlayCount(
        [{ member: { id: 2 }, willPlay: true, guestPlayCount: 3 }],
        {
          adminMemberId: null,
          exemptMemberIds: [],
        },
      ),
    ).toBe(3);
  });

  it("treats null guestPlayCount as 0", () => {
    expect(
      floorableGuestPlayCount(
        [{ member: { id: 2 }, willPlay: true, guestPlayCount: null }],
        {
          adminMemberId: null,
          exemptMemberIds: [],
        },
      ),
    ).toBe(0);
  });
});
