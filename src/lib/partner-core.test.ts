import { describe, it, expect } from "vitest";
import {
  MAX_HEADCOUNT,
  votePlayHeads,
  voteDineHeads,
  resolveVoteWithPartner,
} from "./partner-core";

describe("partner-core", () => {
  it("MAX_HEADCOUNT là 2", () => {
    expect(MAX_HEADCOUNT).toBe(2);
  });

  it("không chơi → 0 đầu chơi dù bật partner", () => {
    expect(votePlayHeads({ willPlay: false, withPartner: true })).toBe(0);
  });

  it("chơi 1 mình → 1 đầu", () => {
    expect(votePlayHeads({ willPlay: true, withPartner: false })).toBe(1);
  });

  it("chơi + partner → 2 đầu", () => {
    expect(votePlayHeads({ willPlay: true, withPartner: true })).toBe(2);
  });

  it("nhậu + partner → 2 đầu; không nhậu → 0", () => {
    expect(voteDineHeads({ willDine: true, withPartner: true })).toBe(2);
    expect(voteDineHeads({ willDine: false, withPartner: true })).toBe(0);
  });

  it("resolveVoteWithPartner: chưa có vote → theo default acc", () => {
    expect(resolveVoteWithPartner(undefined, true)).toBe(true);
    expect(resolveVoteWithPartner(undefined, false)).toBe(false);
  });

  it("resolveVoteWithPartner: có vote → theo snapshot của vote", () => {
    expect(resolveVoteWithPartner({ withPartner: true }, false)).toBe(true);
    expect(resolveVoteWithPartner({ withPartner: false }, true)).toBe(false);
  });
});
