import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { notifications } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const xc = await import("./exchange-comments");
const { enableNotificationsForTest } = await import("./test-helpers");

const NOW = new Date("2026-11-10T03:10:00.000Z");
const HOST = 100;
const event = {
  id: 5,
  publicCode: "ab12cd",
  title: "Giao lưu Thứ 7",
  hostMemberId: HOST,
};
const comment = (over: Record<string, unknown> = {}) => ({
  id: 1,
  channel: "qa" as "qa" | "group",
  parentId: null as number | null,
  authorMemberId: 7,
  ...over,
});
const base = {
  event,
  comment: comment(),
  parentAuthorId: null as number | null,
  replyToMemberId: null as number | null,
  groupMemberIds: [] as number[],
};

const rows = (kind?: string) =>
  testDb
    .select()
    .from(notifications)
    .then((r) => (kind ? r.filter((x) => x.kind === kind) : r));
const visible = (input: typeof base, gate = true, now = NOW) =>
  testDb.transaction((tx) => xc.notifyCommentVisible(tx, input, gate, now));

beforeEach(async () => {
  for (const t of ["notifications", "notification_prefs", "app_settings"]) {
    await client.execute(`DELETE FROM ${t}`).catch(() => undefined);
  }
  await enableNotificationsForTest(testDb);
});

describe("exchange-comments", () => {
  it("held comment notifies only the host", async () => {
    await testDb.transaction((tx) =>
      xc.notifyCommentHeld(tx, { event, commentId: 3 }, true, NOW),
    );
    const r = await rows("exchange_comment_held");
    expect(r).toHaveLength(1);
    expect(r[0].recipientId).toBe(HOST);
    expect(r[0].dedupKey).toBe("xchd:e5:2026-11-10T03:m100");
    expect(r[0].payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: "Giao lưu Thứ 7",
    });
  });

  it("ten questions in one hour give the host one notification", async () => {
    for (let i = 1; i <= 10; i++) {
      await visible(
        { ...base, comment: comment({ id: i, authorMemberId: 10 + i }) },
        true,
        new Date(NOW.getTime() + i * 60_000),
      );
    }
    expect(await rows("exchange_comment_new")).toHaveLength(1);
    await visible(
      { ...base, comment: comment({ id: 11 }) },
      true,
      new Date("2026-11-10T04:00:00.000Z"),
    );
    expect(await rows("exchange_comment_new")).toHaveLength(2);
  });

  it("host's own root comment in qa notifies nobody", async () => {
    await visible({ ...base, comment: comment({ authorMemberId: HOST }) });
    expect(await rows()).toHaveLength(0);
  });

  it("reply notifies parent author and reply target once each, never the writer", async () => {
    await visible({
      ...base,
      comment: comment({ id: 2, parentId: 1, authorMemberId: 9 }),
      parentAuthorId: 7,
      replyToMemberId: 8,
    });
    let r = await rows("exchange_comment_reply");
    expect(r.map((x) => x.recipientId).sort()).toEqual([7, 8]);
    expect(r[0].payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: "Giao lưu Thứ 7",
      channel: "qa",
    });
    // Cha và người được trả lời là cùng một người: một tin.
    await client.execute("DELETE FROM notifications");
    await visible({
      ...base,
      comment: comment({ id: 3, parentId: 1, authorMemberId: 9 }),
      parentAuthorId: 7,
      replyToMemberId: 7,
    });
    r = await rows("exchange_comment_reply");
    expect(r.map((x) => x.recipientId)).toEqual([7]);
    // Tự trả lời mình: không ai nhận.
    await client.execute("DELETE FROM notifications");
    await visible({
      ...base,
      comment: comment({ id: 4, parentId: 1, authorMemberId: 7 }),
      parentAuthorId: 7,
      replyToMemberId: 7,
    });
    expect(await rows()).toHaveLength(0);
  });

  it("group reply never notifies someone no longer approved", async () => {
    await visible({
      ...base,
      comment: comment({
        id: 2,
        channel: "group",
        parentId: 1,
        authorMemberId: 9,
      }),
      parentAuthorId: 7,
      replyToMemberId: HOST,
      groupMemberIds: [8, 9],
    });
    const r = await rows("exchange_comment_reply");
    expect(r.map((x) => x.recipientId)).toEqual([HOST]);
    expect(r[0].payload).toMatchObject({ channel: "group" });
  });

  it("host group post notifies approved registrants only", async () => {
    await visible({
      ...base,
      comment: comment({ id: 6, channel: "group", authorMemberId: HOST }),
      groupMemberIds: [7, 8, HOST],
    });
    const r = await rows("exchange_comment_host_post");
    expect(r.map((x) => x.recipientId).sort()).toEqual([7, 8]);
    expect(r[0].dedupKey).toBe("xch:c6:m7");
    expect(r[0].payload).toEqual({
      eventCode: "ab12cd",
      eventTitle: "Giao lưu Thứ 7",
    });
  });

  it("approving a held reply notifies the parent author", async () => {
    // Cùng đường gọi với lúc viết mới: bình luận vừa thành visible.
    await visible({
      ...base,
      comment: comment({ id: 12, parentId: 1, authorMemberId: 9 }),
      parentAuthorId: 7,
    });
    const r = await rows("exchange_comment_reply");
    expect(r.map((x) => x.recipientId)).toEqual([7]);
  });

  it("gate false writes nothing", async () => {
    await visible(base, false);
    await visible(
      { ...base, comment: comment({ parentId: 1 }), parentAuthorId: 8 },
      false,
    );
    await visible(
      {
        ...base,
        comment: comment({ channel: "group", authorMemberId: HOST }),
        groupMemberIds: [7],
      },
      false,
    );
    await testDb.transaction((tx) =>
      xc.notifyCommentHeld(tx, { event, commentId: 1 }, false, NOW),
    );
    expect(await rows()).toHaveLength(0);
  });

  it("payload has no name and no body", async () => {
    await visible(base);
    await visible({
      ...base,
      comment: comment({ id: 2, parentId: 1, authorMemberId: 9 }),
      parentAuthorId: 7,
    });
    const all = await rows();
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      const keys = Object.keys(r.payload as object);
      expect(
        keys.every((k) => ["eventCode", "eventTitle", "channel"].includes(k)),
      ).toBe(true);
    }
  });
});
