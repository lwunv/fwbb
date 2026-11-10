import { describe, it, expect } from "vitest";
import {
  PUBLIC_PLAYER_PROFILE_KEYS,
  toPublicPlayerProfile,
  type Reputation,
} from "./public-profile";

function rep(): Reputation {
  return {
    member: {
      name: "Lan",
      avatarUrl: "https://img/a.png",
      avatarKey: "k1",
      skillLevel: "tb",
      approvalStatus: "pending",
      isActive: true,
    },
    attendance: {
      attended: 4,
      approvedPast: 5,
      lateCancels: 1,
      noShows: 0,
      charged: 3,
      paidOnTime: 3,
      isNew: false,
    },
    peer: {
      raters: 3,
      playAgain: 2,
      tags: [{ tag: "friendly", count: 2 }],
      skill: { level: "tb", raters: 3 },
    },
    host: {
      organized: 2,
      cancelled: 0,
      cancelPct: 0,
      raters: null,
      asDescribedPct: null,
      feeAsPromisedPct: null,
    },
    referred: false,
  };
}

describe("toPublicPlayerProfile", () => {
  it("keeps exactly PUBLIC_PLAYER_PROFILE_KEYS and copies the values", () => {
    const p = toPublicPlayerProfile("abcdefghjk", rep());
    expect(Object.keys(p).sort()).toEqual(
      [...PUBLIC_PLAYER_PROFILE_KEYS].sort(),
    );
    expect(p).toEqual({
      code: "abcdefghjk",
      name: "Lan",
      avatarUrl: "https://img/a.png",
      avatarKey: "k1",
      selfSkill: "tb",
      isNew: false,
      referred: false,
      attendance: {
        attended: 4,
        approvedPast: 5,
        lateCancels: 1,
        noShows: 0,
        charged: 3,
        paidOnTime: 3,
      },
      peer: {
        raters: 3,
        playAgain: 2,
        tags: [{ tag: "friendly", count: 2 }],
        skill: { level: "tb", raters: 3 },
      },
      host: {
        organized: 2,
        cancelled: 0,
        cancelPct: 0,
        raters: null,
        asDescribedPct: null,
        feeAsPromisedPct: null,
      },
    });
  });

  it("drops fields that are not whitelisted, nested ones too", () => {
    const r = rep() as Reputation & Record<string, unknown>;
    const leaky = {
      ...r,
      id: 42,
      email: "x@y.z",
      member: { ...r.member, id: 42, phoneNumber: "0900", email: "x@y.z" },
      attendance: { ...r.attendance, memberId: 42 },
      peer: {
        ...r.peer,
        raterNames: ["Secret"],
        tags: [{ tag: "friendly", count: 2, from: 7 }],
        skill: { level: "tb", raters: 3, fromIds: [7] },
      },
      host: { ...r.host, events: ["ev00000001"] },
    } as unknown as Reputation;
    const json = JSON.stringify(toPublicPlayerProfile("abcdefghjk", leaky));
    for (const bad of [
      "42",
      "x@y.z",
      "0900",
      "Secret",
      "ev00000001",
      "memberId",
      "fromIds",
      '"from"',
      '"id"',
    ]) {
      expect(json).not.toContain(bad);
    }
  });

  it("a new account keeps isNew and has no host block when host is null", () => {
    const r = rep();
    r.attendance.isNew = true;
    r.host = null;
    r.member.skillLevel = null;
    const p = toPublicPlayerProfile("abcdefghjk", r);
    expect(p.isNew).toBe(true);
    expect(p.host).toBeNull();
    expect(p.selfSkill).toBeNull();
    expect("isNew" in p.attendance).toBe(false);
  });
});
