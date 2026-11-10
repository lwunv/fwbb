/**
 * Làm mới cache uy tín theo member: đọc fan-out theo index (không SCAN), có
 * trần 500 dòng mỗi lần đọc, và chỉ làm mới trung bình chung mọi sân khi
 * member có đánh giá đang hiện.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  hostFeedback,
  members,
  peerFeedback,
  venueReviews,
  venues,
} from "@/db/schema";

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));

const { db: testDb, client } = await createTestDb();
const {
  FANOUT_CAP,
  invalidateMemberReputation,
  ratedHostsQuery,
  ratedMembersQuery,
  reviewedVenuesQuery,
} = await import("./invalidate");

const NOW = "2026-11-05T00:00:00.000Z";

async function tags(): Promise<string[]> {
  const { updateTag } = await import("next/cache");
  return vi.mocked(updateTag).mock.calls.map((c) => c[0]);
}

async function mkMembers(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 100) {
    const rows = await testDb
      .insert(members)
      .values(
        Array.from({ length: Math.min(100, n - i) }, (_, k) => ({
          name: `m${i + k}`,
          approvalStatus: "approved" as const,
        })),
      )
      .returning({ id: members.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

async function mkVenues(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 100) {
    const rows = await testDb
      .insert(venues)
      .values(
        Array.from({ length: Math.min(100, n - i) }, (_, k) => ({
          name: `San ${i + k}`,
          lat: 10,
          lng: 106,
        })),
      )
      .returning({ id: venues.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

function eventRow(hostId: number, venueId: number, code: string) {
  return {
    publicCode: code,
    hostMemberId: hostId,
    venueId,
    title: "Giao lưu",
    startAt: "2026-11-01T12:00:00.000Z",
    endAt: "2026-11-01T14:00:00.000Z",
    slotsTotal: 10,
    feeMode: "fixed" as const,
    registerDeadline: "2026-11-01T10:00:00.000Z",
    cancelDeadline: "2026-11-01T08:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function reviewRow(
  venueId: number,
  memberId: number,
  status: "visible" | "held" = "visible",
) {
  return {
    venueId,
    memberId,
    scoreSurface: 4,
    scoreLighting: 4,
    scoreVentilation: 4,
    scorePrice: 4,
    scoreParking: 4,
    scoreOwner: 4,
    status,
    raterWeight: 5,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function planOf(q: { toSQL(): { sql: string; params: unknown[] } }) {
  const s = q.toSQL();
  const plan = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${s.sql}`,
    args: s.params as (string | number)[],
  });
  return plan.rows.map((r) => String(r.detail));
}

beforeEach(async () => {
  for (const t of [
    "peer_feedback",
    "host_feedback",
    "venue_reviews",
    "exchange_events",
    "venues",
    "members",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
  const { updateTag } = await import("next/cache");
  vi.mocked(updateTag).mockClear();
});

describe("invalidateMemberReputation", () => {
  it("EXPLAIN QUERY PLAN of the three fan-out reads uses the member indexes, no SCAN", async () => {
    const ids = [1, 2];
    const reviewed = await planOf(reviewedVenuesQuery(testDb, ids));
    const rated = await planOf(ratedMembersQuery(testDb, ids));
    const hosts = await planOf(ratedHostsQuery(testDb, ids));

    expect(reviewed.join("\n")).toContain("venue_reviews_member_idx");
    expect(rated.join("\n")).toContain("peer_feedback_from_idx");
    expect(hosts.join("\n")).toContain("host_feedback_from_idx");
    for (const details of [reviewed, rated, hosts]) {
      expect(details.filter((d) => /^SCAN\b/.test(d))).toEqual([]);
    }
  });

  it("caps each fan-out read at FANOUT_CAP rows", async () => {
    expect(FANOUT_CAP).toBe(500);
    const n = FANOUT_CAP + 1;
    const [rater] = await mkMembers(1);
    const rated = await mkMembers(n);
    const hosts = await mkMembers(n);
    const vs = await mkVenues(n);

    for (let i = 0; i < n; i += 100) {
      const slice = hosts.slice(i, i + 100);
      const evs = await testDb
        .insert(exchangeEvents)
        .values(slice.map((h, k) => eventRow(h, vs[i + k], `CAP${i + k}`)))
        .returning({ id: exchangeEvents.id });
      await testDb.insert(hostFeedback).values(
        evs.map((e) => ({
          eventId: e.id,
          fromMemberId: rater,
          asDescribed: true,
          feeAsPromised: true,
          raterWeight: 5,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      );
      await testDb.insert(peerFeedback).values(
        evs.map((e, k) => ({
          eventId: e.id,
          fromMemberId: rater,
          toMemberId: rated[i + k],
          raterWeight: 5,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      );
      await testDb
        .insert(venueReviews)
        .values(vs.slice(i, i + 100).map((v) => reviewRow(v, rater)));
    }

    await invalidateMemberReputation(testDb, [rater], { asRater: true });

    const got = new Set(await tags());
    const count = (xs: string[]) => xs.filter((t) => got.has(t)).length;
    expect(count(rated.map((id) => `rep:m${id}`))).toBe(FANOUT_CAP);
    expect(count(hosts.map((id) => `rep:m${id}`))).toBe(FANOUT_CAP);
    expect(count(vs.map((id) => `vrev:v${id}`))).toBe(FANOUT_CAP);
    expect(got.has(`rep:m${rater}`)).toBe(true);
  });

  it("a rater whose only review is held refreshes that venue but not vrev:all", async () => {
    const [rater] = await mkMembers(1);
    const [v] = await mkVenues(1);
    await testDb.insert(venueReviews).values(reviewRow(v, rater, "held"));

    await invalidateMemberReputation(testDb, [rater], { asRater: true });

    const got = await tags();
    expect(got).toContain(`rep:m${rater}`);
    expect(got).toContain(`vrev:v${v}`);
    expect(got).not.toContain("vrev:all");
  });

  it("a rater with a visible review also refreshes vrev:all", async () => {
    const [rater] = await mkMembers(1);
    const [v1, v2] = await mkVenues(2);
    await testDb
      .insert(venueReviews)
      .values([reviewRow(v1, rater, "held"), reviewRow(v2, rater)]);

    await invalidateMemberReputation(testDb, [rater], { asRater: true });

    expect(await tags()).toContain("vrev:all");
  });

  it("rated ids get their own profile tag only", async () => {
    const [m, y] = await mkMembers(2);

    await invalidateMemberReputation(testDb, [m], { rated: [y] });

    expect((await tags()).sort()).toEqual([`rep:m${m}`, `rep:m${y}`].sort());
  });
});
