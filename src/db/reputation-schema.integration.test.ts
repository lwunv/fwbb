import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeEvents,
  hostFeedback,
  memberIpSignals,
  members,
  peerFeedback,
  referrals,
  venueReviews,
  venues,
} from "@/db/schema";

const { db, client } = await createTestDb();
// SQLite file để foreign_keys=OFF theo từng kết nối; bật như src/db/index.ts
// để kiểm được cascade của member_ip_signals.
await client.execute("PRAGMA foreign_keys=ON");

const now = new Date().toISOString();

let seq = 0;
async function newMember(name = "M") {
  seq += 1;
  const [m] = await db
    .insert(members)
    .values({ name, facebookId: `rep-${seq}` })
    .returning();
  return m;
}

const host = await newMember("Host");
const a = await newMember("A");
const b = await newMember("B");
const [venue] = await db
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning();
const [event] = await db
  .insert(exchangeEvents)
  .values({
    publicCode: "rcode1",
    hostMemberId: host.id,
    venueId: venue.id,
    title: "T",
    startAt: now,
    endAt: now,
    slotsTotal: 10,
    feeMode: "fixed",
    registerDeadline: now,
    cancelDeadline: now,
    createdAt: now,
    updatedAt: now,
  })
  .returning();

const reviewRow = (over: Record<string, unknown> = {}) => ({
  venueId: venue.id,
  memberId: a.id,
  scoreSurface: 4,
  scoreLighting: 4,
  scoreVentilation: 4,
  scorePrice: 4,
  scoreParking: 4,
  scoreOwner: 4,
  raterWeight: 5,
  createdAt: now,
  updatedAt: now,
  ...over,
});

async function indexNames(table: string): Promise<string[]> {
  const r = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
    args: [table],
  });
  return r.rows.map((x) => String(x.name));
}

describe("reputation schema", () => {
  it("creates the six new tables with every declared index (18 new indexes, including member_ip_signals(last_seen_at) and exchange_events(end_at))", async () => {
    const t = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tables = t.rows.map((x) => String(x.name));
    for (const n of [
      "peer_feedback",
      "host_feedback",
      "venue_reviews",
      "host_flag_reviews",
      "referrals",
      "member_ip_signals",
    ]) {
      expect(tables).toContain(n);
    }

    const expected: Record<string, string[]> = {
      peer_feedback: [
        "peer_feedback_event_from_to_unique",
        "peer_feedback_to_updated_idx",
        "peer_feedback_from_idx",
      ],
      host_feedback: [
        "host_feedback_event_from_unique",
        "host_feedback_from_idx",
      ],
      venue_reviews: [
        "venue_reviews_venue_member_unique",
        "venue_reviews_venue_status_created_idx",
        "venue_reviews_status_updated_idx",
        "venue_reviews_member_idx",
      ],
      host_flag_reviews: ["host_flag_reviews_host_unique"],
      referrals: ["referrals_referee_unique", "referrals_referrer_created_idx"],
      member_ip_signals: [
        "member_ip_signals_member_hash_kind_unique",
        "member_ip_signals_hash_last_seen_idx",
        "member_ip_signals_last_seen_idx",
      ],
      members: ["members_public_code_unique"],
      session_attendees: ["session_attendees_member_idx"],
      exchange_events: ["exchange_events_end_at_idx"],
    };
    let total = 0;
    for (const [table, names] of Object.entries(expected)) {
      const have = await indexNames(table);
      for (const n of names) expect(have).toContain(n);
      total += names.length;
    }
    expect(total).toBe(18);

    const lastSeen = await client.execute(
      "SELECT name FROM pragma_index_info('member_ip_signals_last_seen_idx')",
    );
    expect(lastSeen.rows.map((x) => String(x.name))).toEqual(["last_seen_at"]);
    const endAt = await client.execute(
      "SELECT name FROM pragma_index_info('exchange_events_end_at_idx')",
    );
    expect(endAt.rows.map((x) => String(x.name))).toEqual(["end_at"]);
  });

  it("members.public_code is unique but allows many NULLs", async () => {
    const x = await newMember("X");
    const y = await newMember("Y");
    await client.execute({
      sql: "UPDATE members SET public_code = 'abcdefghij' WHERE id = ?",
      args: [x.id],
    });
    await expect(
      client.execute({
        sql: "UPDATE members SET public_code = 'abcdefghij' WHERE id = ?",
        args: [y.id],
      }),
    ).rejects.toThrow();
    const nulls = await client.execute(
      "SELECT count(*) AS n FROM members WHERE public_code IS NULL",
    );
    expect(Number(nulls.rows[0].n)).toBeGreaterThan(1);
  });

  it("members.public_code defaults to NULL", async () => {
    const m = await newMember("Z");
    expect(m.publicCode).toBeNull();
  });

  it("session_attendees gets the member index", async () => {
    const info = await client.execute(
      "SELECT name FROM pragma_index_info('session_attendees_member_idx')",
    );
    expect(info.rows.map((x) => String(x.name))).toEqual(["member_id"]);
  });

  it("peer feedback (event, from, to) is unique and a self pair is rejected", async () => {
    const row = {
      eventId: event.id,
      fromMemberId: a.id,
      toMemberId: b.id,
      raterWeight: 5,
      createdAt: now,
      updatedAt: now,
    };
    const [p] = await db.insert(peerFeedback).values(row).returning();
    expect(p.playAgain).toBe(false);
    expect(p.tags).toBe("[]");
    expect(p.skillLevel).toBeNull();
    await expect(db.insert(peerFeedback).values(row)).rejects.toThrow();
    await expect(
      db.insert(peerFeedback).values({ ...row, toMemberId: a.id }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(peerFeedback)
        .values({ ...row, toMemberId: host.id, raterWeight: 6 }),
    ).rejects.toThrow();
  });

  it("host feedback (event, from) is unique", async () => {
    const row = {
      eventId: event.id,
      fromMemberId: a.id,
      asDescribed: true,
      feeAsPromised: false,
      raterWeight: 1,
      createdAt: now,
      updatedAt: now,
    };
    const [h] = await db.insert(hostFeedback).values(row).returning();
    expect(h.idempotencyKey).toBeNull();
    await expect(db.insert(hostFeedback).values(row)).rejects.toThrow();
    await expect(
      db
        .insert(hostFeedback)
        .values({ ...row, fromMemberId: b.id, raterWeight: -1 }),
    ).rejects.toThrow();
  });

  it("venue review score 0 or 6 and rater_weight 6 are rejected; (venue, member) is unique", async () => {
    for (const bad of [
      { scoreSurface: 0 },
      { scoreOwner: 6 },
      { scorePrice: 0 },
      { raterWeight: 6 },
      { reportCount: -1 },
    ]) {
      await expect(
        db.insert(venueReviews).values(reviewRow(bad)),
      ).rejects.toThrow();
    }
    const [r] = await db.insert(venueReviews).values(reviewRow()).returning();
    expect(r.status).toBe("visible");
    expect(r.reportCount).toBe(0);
    expect(r.comment).toBeNull();
    expect(r.holdReason).toBeNull();
    expect(r.editedAt).toBeNull();
    await expect(db.insert(venueReviews).values(reviewRow())).rejects.toThrow();
  });

  it("referrals referee is unique and a self referral is rejected", async () => {
    await db.insert(referrals).values({
      referrerMemberId: a.id,
      refereeMemberId: b.id,
      createdAt: now,
    });
    await expect(
      db.insert(referrals).values({
        referrerMemberId: host.id,
        refereeMemberId: b.id,
        createdAt: now,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(referrals).values({
        referrerMemberId: host.id,
        refereeMemberId: host.id,
        createdAt: now,
      }),
    ).rejects.toThrow();
  });

  it("member_ip_signals (member, hash, kind) is unique and rows go away with the member", async () => {
    const m = await newMember("Ip");
    const row = {
      memberId: m.id,
      ipHash: "h1",
      kind: "signup" as const,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    await db.insert(memberIpSignals).values(row);
    await expect(db.insert(memberIpSignals).values(row)).rejects.toThrow();
    await db.insert(memberIpSignals).values({ ...row, kind: "login" });
    await client.execute({
      sql: "DELETE FROM members WHERE id = ?",
      args: [m.id],
    });
    const left = await client.execute({
      sql: "SELECT count(*) AS n FROM member_ip_signals WHERE member_id = ?",
      args: [m.id],
    });
    expect(Number(left.rows[0].n)).toBe(0);
  });
});
