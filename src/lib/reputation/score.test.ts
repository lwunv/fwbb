import { describe, expect, it } from "vitest";
import {
  canRate,
  feedbackWindow,
  formatTenths,
  isReviewAnomalous,
  keepEventsWithRaters,
  latestPerRater,
  percent,
  roundHalfUp,
  summarizeHost,
  summarizePeer,
  venueScore,
  vnMonth,
  weight5,
  weightedMedianSkill,
  windowClosed,
  type HostRow,
  type PeerRow,
  type VenueSums,
} from "./score";

const END = "2026-11-01T13:00:00.000Z";
const endMs = Date.parse(END);
const DAY = 86_400_000;

let nextId = 1;
function peer(
  p: Partial<PeerRow> & { eventId: number; fromId: number },
): PeerRow {
  return {
    id: nextId++,
    updatedAt: "2026-11-01T14:00:00.000Z",
    w5: 5,
    playAgain: false,
    tags: [],
    skill: null,
    ...p,
  };
}
function host(
  h: Partial<HostRow> & { eventId: number; fromId: number },
): HostRow {
  return {
    id: nextId++,
    updatedAt: "2026-11-01T14:00:00.000Z",
    w5: 5,
    asDescribed: true,
    feeAsPromised: true,
    ...h,
  };
}

const EMPTY_PRIOR: VenueSums = {
  count: 0,
  w: 0,
  surface: 0,
  lighting: 0,
  ventilation: 0,
  price: 0,
  parking: 0,
  owner: 0,
};
/** Tổng của `n` đánh giá cùng trọng số `w5`, mọi tiêu chí cùng điểm `score`. */
function sums(n: number, w5: number, score: number): VenueSums {
  const s = n * w5 * score;
  return {
    count: n,
    w: n * w5,
    surface: s,
    lighting: s,
    ventilation: s,
    price: s,
    parking: s,
    owner: s,
  };
}

describe("weights and rounding", () => {
  it("weight5: 0, 1, 4, 5, 12, -1, NaN → 0, 1, 4, 5, 5, 0, 0", () => {
    expect([0, 1, 4, 5, 12, -1, NaN].map(weight5)).toEqual([
      0, 1, 4, 5, 5, 0, 0,
    ]);
  });

  it("roundHalfUp: 5/2 → 3, 7/3 → 2, 1/2 → 1, 0/9 → 0", () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(7, 3)).toBe(2);
    expect(roundHalfUp(1, 2)).toBe(1);
    expect(roundHalfUp(0, 9)).toBe(0);
  });

  it("percent: 2 of 3 → 67, 1 of 3 → 33, 0 of 0 → null", () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
  });
});

describe("feedback window", () => {
  it("feedbackWindow: endAt minus 1 ms notYet; endAt open; endAt plus 7 days open; plus 7 days and 1 ms closed", () => {
    expect(feedbackWindow(END, new Date(endMs - 1))).toBe("notYet");
    expect(feedbackWindow(END, new Date(endMs))).toBe("open");
    expect(feedbackWindow(END, new Date(endMs + 7 * DAY))).toBe("open");
    expect(feedbackWindow(END, new Date(endMs + 7 * DAY + 1))).toBe("closed");
  });

  it("windowClosed is true exactly at endAt plus 7 days", () => {
    expect(windowClosed(END, new Date(endMs + 7 * DAY - 1))).toBe(false);
    expect(windowClosed(END, new Date(endMs + 7 * DAY))).toBe(true);
  });

  it("canRate: checked in inside the window yes; not checked in, hidden, cancelled or outside the window no", () => {
    const ev = { endAt: END, status: "open" as const, hidden: false };
    const inside = new Date(endMs + DAY);
    expect(canRate(ev, { checkedIn: true }, inside)).toBe(true);
    expect(canRate(ev, { checkedIn: false }, inside)).toBe(false);
    expect(canRate(ev, null, inside)).toBe(false);
    expect(canRate({ ...ev, hidden: true }, { checkedIn: true }, inside)).toBe(
      false,
    );
    expect(
      canRate({ ...ev, status: "cancelled" }, { checkedIn: true }, inside),
    ).toBe(false);
    expect(canRate(ev, { checkedIn: true }, new Date(endMs - 1))).toBe(false);
    expect(canRate(ev, { checkedIn: true }, new Date(endMs + 8 * DAY))).toBe(
      false,
    );
  });
});

describe("rater filters", () => {
  it("keepEventsWithRaters drops every row of an event with 2 raters and keeps an event with 3", () => {
    const rows = [
      { eventId: 1, fromId: 10 },
      { eventId: 1, fromId: 11 },
      { eventId: 1, fromId: 11 },
      { eventId: 2, fromId: 10 },
      { eventId: 2, fromId: 11 },
      { eventId: 2, fromId: 12 },
    ];
    expect(keepEventsWithRaters(rows, 3)).toEqual(rows.slice(3));
  });

  it("latestPerRater keeps the newest row per rater and breaks a same-time tie by the larger id", () => {
    const rows = [
      { id: 1, fromId: 10, updatedAt: "2026-11-01T10:00:00.000Z" },
      { id: 2, fromId: 10, updatedAt: "2026-11-02T10:00:00.000Z" },
      { id: 3, fromId: 11, updatedAt: "2026-11-02T10:00:00.000Z" },
      { id: 4, fromId: 11, updatedAt: "2026-11-02T10:00:00.000Z" },
      { id: 5, fromId: 10, updatedAt: "2026-10-30T10:00:00.000Z" },
    ];
    const kept = latestPerRater(rows)
      .map((r) => r.id)
      .sort();
    expect(kept).toEqual([2, 4]);
  });

  it("weighted median: [tb 1, tb 1, tbk 5] → tbk; [yeu 5, tb 5] → yeu; [tby 1, tb 1, tbk 1] → tb; empty or all 0 → null", () => {
    expect(
      weightedMedianSkill([
        { level: "tb", w5: 1 },
        { level: "tb", w5: 1 },
        { level: "tbk", w5: 5 },
      ]),
    ).toBe("tbk");
    expect(
      weightedMedianSkill([
        { level: "yeu", w5: 5 },
        { level: "tb", w5: 5 },
      ]),
    ).toBe("yeu");
    expect(
      weightedMedianSkill([
        { level: "tby", w5: 1 },
        { level: "tb", w5: 1 },
        { level: "tbk", w5: 1 },
      ]),
    ).toBe("tb");
    expect(weightedMedianSkill([])).toBeNull();
    expect(weightedMedianSkill([{ level: "tb", w5: 0 }])).toBeNull();
  });
});

describe("summarizePeer", () => {
  const NOTHING = { raters: null, playAgain: null, tags: [], skill: null };

  it("two raters show nothing and raters is null", () => {
    const rows = [
      peer({
        eventId: 1,
        fromId: 10,
        playAgain: true,
        tags: ["on_time"],
        skill: "tb",
      }),
      peer({
        eventId: 1,
        fromId: 11,
        playAgain: true,
        tags: ["on_time"],
        skill: "tb",
      }),
    ];
    expect(summarizePeer(rows)).toEqual(NOTHING);
  });

  it("ratings from three events with one rater each show nothing", () => {
    const rows = [
      peer({ eventId: 1, fromId: 10, playAgain: true }),
      peer({ eventId: 2, fromId: 11, playAgain: true }),
      peer({ eventId: 3, fromId: 12, playAgain: true }),
    ];
    expect(summarizePeer(rows)).toEqual(NOTHING);
  });

  it("five one-event raters at one event add up to one play-again; three one-event raters show no play-again line", () => {
    const five = [10, 11, 12, 13, 14].map((fromId) =>
      peer({ eventId: 1, fromId, w5: 1, playAgain: true }),
    );
    expect(summarizePeer(five)).toMatchObject({ raters: 5, playAgain: 1 });
    const three = five.slice(0, 3);
    expect(summarizePeer(three)).toMatchObject({ raters: 3, playAgain: null });
  });

  it("one rater who rated the same player in three events counts once with the latest answer", () => {
    const rows = [1, 2, 3].flatMap((eventId) => [
      peer({
        eventId,
        fromId: 10,
        playAgain: eventId !== 3,
        updatedAt: `2026-11-0${eventId}T14:00:00.000Z`,
      }),
      peer({ eventId, fromId: 20 + eventId, playAgain: true }),
      peer({ eventId, fromId: 30 + eventId, playAgain: true }),
    ]);
    // 7 người chấm khác nhau; người 10 chỉ còn lượt buổi 3 (không bấm).
    expect(summarizePeer(rows)).toMatchObject({ raters: 7, playAgain: 6 });
  });

  it("tags under one full weight are dropped; the rest sort by count then fixed order", () => {
    const rows = [
      peer({
        eventId: 1,
        fromId: 10,
        tags: ["nice_play", "fair_play", "on_time"],
      }),
      peer({ eventId: 1, fromId: 11, tags: ["nice_play", "fair_play"] }),
      peer({ eventId: 1, fromId: 12, w5: 4, tags: ["friendly", "nice_play"] }),
    ];
    // friendly chỉ 4/5 → bỏ; fair_play và nice_play cùng 2 → theo thứ tự PEER_TAGS.
    expect(summarizePeer(rows).tags).toEqual([
      { tag: "fair_play", count: 2 },
      { tag: "nice_play", count: 2 },
      { tag: "on_time", count: 1 },
    ]);
  });

  it("peer skill needs three raters who picked a level", () => {
    const two = [
      peer({ eventId: 1, fromId: 10, skill: "tb" }),
      peer({ eventId: 1, fromId: 11, skill: "tbk" }),
      peer({ eventId: 1, fromId: 12 }),
    ];
    expect(summarizePeer(two)).toMatchObject({ raters: 3, skill: null });
    const three = [
      ...two.slice(0, 2),
      peer({ eventId: 1, fromId: 12, skill: "yeu" }),
    ];
    expect(summarizePeer(three).skill).toEqual({ level: "tb", raters: 3 });
  });
});

describe("summarizeHost", () => {
  it("host percent is weighted: two full-weight yes and one 1/5 no at one event → 91", () => {
    const rows = [
      host({ eventId: 1, fromId: 10 }),
      host({ eventId: 1, fromId: 11 }),
      host({ eventId: 1, fromId: 12, w5: 1, asDescribed: false }),
    ];
    expect(summarizeHost(rows)).toEqual({
      raters: 3,
      asDescribedPct: 91,
      feeAsPromisedPct: 100,
    });
  });

  it("under three raters every field is null", () => {
    const rows = [
      host({ eventId: 1, fromId: 10 }),
      host({ eventId: 1, fromId: 11 }),
    ];
    expect(summarizeHost(rows)).toEqual({
      raters: null,
      asDescribedPct: null,
      feeAsPromisedPct: null,
    });
  });
});

describe("venueScore", () => {
  it("venue score: under 3 reviews all null; three perfect full-weight reviews with an empty prior → 38; three perfect one-event reviews against a prior of 3 → 32; 3,25 rounds to 33; overall uses the same pull", () => {
    const two = venueScore(sums(2, 5, 5), EMPTY_PRIOR);
    expect(two.count).toBe(2);
    expect(two.overall).toBeNull();
    expect(Object.values(two.criteria).every((v) => v === null)).toBe(true);

    // (75 + 25 * 3) / 40 = 3,75 → 38.
    const full = venueScore(sums(3, 5, 5), EMPTY_PRIOR);
    expect(full.criteria.surface).toBe(38);
    expect(full.overall).toBe(38);

    // (15 + 25 * 3) / 28 = 3,21 → 32; prior thật có trung bình 3.
    const light = venueScore(sums(3, 1, 5), sums(40, 5, 3));
    expect(light.criteria.owner).toBe(32);
    expect(light.overall).toBe(32);

    // Điểm 5, 3, 3 nặng đủ: (55 + 75) / 40 = 3,25 → 33.
    const half: VenueSums = {
      count: 3,
      w: 15,
      surface: 55,
      lighting: 75,
      ventilation: 75,
      price: 75,
      parking: 75,
      owner: 75,
    };
    const s = venueScore(half, EMPTY_PRIOR);
    expect(s.criteria.surface).toBe(33);
    expect(s.criteria.lighting).toBe(38);
    // Điểm chung: (55 + 5 * 75 + 6 * 75) / (6 * 40) = 880 / 240 = 3,67 → 37.
    expect(s.overall).toBe(37);
  });
});

describe("anomaly and formatting", () => {
  it("anomaly: 5 new in 24h true; 2 of 3 under 3 events true; 1 of 2 false; 2 of 4 false", () => {
    expect(isReviewAnomalous({ recent24h: 5, total: 5, lowRep: 0 })).toBe(true);
    expect(isReviewAnomalous({ recent24h: 1, total: 3, lowRep: 2 })).toBe(true);
    expect(isReviewAnomalous({ recent24h: 1, total: 2, lowRep: 1 })).toBe(
      false,
    );
    expect(isReviewAnomalous({ recent24h: 1, total: 4, lowRep: 2 })).toBe(
      false,
    );
  });

  it('formatTenths 43 → "4,3" in vi, "4.3" in en', () => {
    expect(formatTenths(43, "vi")).toBe("4,3");
    expect(formatTenths(43, "en")).toBe("4.3");
    expect(formatTenths(50, "vi")).toBe("5,0");
  });

  it('vnMonth("2026-10-31T18:00:00.000Z") → "2026-11"', () => {
    expect(vnMonth("2026-10-31T18:00:00.000Z")).toBe("2026-11");
    expect(vnMonth("2026-10-31T16:59:59.000Z")).toBe("2026-10");
  });
});
