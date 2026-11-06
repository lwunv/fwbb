import { describe, it, expect } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  exchangeComments,
  exchangeCommentVotes,
  exchangeCommentReads,
  exchangeEvents,
  members,
  venues,
} from "@/db/schema";

const { db, client } = await createTestDb();

const now = new Date().toISOString();

const [member] = await db
  .insert(members)
  .values({ name: "Host", facebookId: "c-host" })
  .returning();
const [venue] = await db
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning();
const [event] = await db
  .insert(exchangeEvents)
  .values({
    publicCode: "ccode1",
    hostMemberId: member.id,
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

const commentRow = (over: Record<string, unknown> = {}) => ({
  eventId: event.id,
  channel: "qa" as const,
  authorMemberId: member.id,
  body: "hi",
  createdAt: now,
  ...over,
});

describe("exchange comments schema", () => {
  it("creates the three comment tables with every declared index", async () => {
    const r = await client.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE 'exchange_comment%'",
    );
    const names = r.rows.map((x) => String(x.name));
    for (const n of [
      "exchange_comments",
      "exchange_comment_votes",
      "exchange_comment_reads",
      "exchange_comments_event_channel_created_idx",
      "exchange_comments_event_created_idx",
      "exchange_comments_parent_created_idx",
      "exchange_comments_author_created_idx",
      "exchange_comments_idempotency_key_unique",
      "exchange_comment_votes_comment_member_unique",
      "exchange_comment_votes_member_idx",
      "exchange_comment_reads_event_member_unique",
      "exchange_comment_reads_member_idx",
    ]) {
      expect(names).toContain(n);
    }
  });

  it("comment vote (comment, member) is unique", async () => {
    const [c] = await db
      .insert(exchangeComments)
      .values(commentRow())
      .returning();
    expect(c.status).toBe("visible");
    expect(c.upvotes).toBe(0);
    expect(c.pinned).toBe(false);
    await db
      .insert(exchangeCommentVotes)
      .values({ commentId: c.id, memberId: member.id, createdAt: now });
    await expect(
      db
        .insert(exchangeCommentVotes)
        .values({ commentId: c.id, memberId: member.id, createdAt: now }),
    ).rejects.toThrow();
  });

  it("comment read (event, member) is unique", async () => {
    await db
      .insert(exchangeCommentReads)
      .values({ eventId: event.id, memberId: member.id });
    await expect(
      db
        .insert(exchangeCommentReads)
        .values({ eventId: event.id, memberId: member.id }),
    ).rejects.toThrow();
  });

  it("negative upvotes rejected", async () => {
    await expect(
      db.insert(exchangeComments).values(commentRow({ upvotes: -1 })),
    ).rejects.toThrow();
  });

  it("exchange_events.comments_locked defaults to 0 for an existing row", async () => {
    const r = await client.execute(
      `SELECT comments_locked FROM exchange_events WHERE id = ${event.id}`,
    );
    expect(Number(r.rows[0].comments_locked)).toBe(0);
    expect(event.commentsLocked).toBe(false);
  });
});
