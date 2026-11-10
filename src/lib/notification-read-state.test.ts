import { describe, it, expect } from "vitest";
import {
  parseReadSnapshot,
  isNotificationUnread,
  notificationKey,
  addReadKey,
  READ_KEYS_CAP,
} from "./notification-read-state";

const NOW = new Date("2026-11-06T05:00:00Z");

describe("notification read state", () => {
  it("key = memberId-txId", () => {
    expect(notificationKey({ memberId: 56, txId: 900 })).toBe("56-900");
  });

  it("chưa từng xem: tin trong 7 ngày là chưa đọc, cũ hơn thì không", () => {
    const st = parseReadSnapshot("|[]");
    expect(isNotificationUnread(st, "1-1", "2026-11-05 10:00:00", NOW)).toBe(
      true,
    );
    expect(isNotificationUnread(st, "1-2", "2026-10-01 10:00:00", NOW)).toBe(
      false,
    );
  });

  it("tin sau mốc 'đã xem tất cả' là chưa đọc; tin trước mốc thì đã đọc", () => {
    const st = parseReadSnapshot("2026-11-04T00:00:00.000Z|[]");
    expect(isNotificationUnread(st, "1-1", "2026-11-05 10:00:00", NOW)).toBe(
      true,
    );
    expect(isNotificationUnread(st, "1-2", "2026-11-03 10:00:00", NOW)).toBe(
      false,
    );
  });

  it("bấm vào 1 tin → riêng tin đó thành đã đọc", () => {
    const st = parseReadSnapshot(`|${JSON.stringify(["1-1"])}`);
    expect(isNotificationUnread(st, "1-1", "2026-11-05 10:00:00", NOW)).toBe(
      false,
    );
    expect(isNotificationUnread(st, "2-2", "2026-11-05 10:00:00", NOW)).toBe(
      true,
    );
  });

  it("snapshot hỏng → coi như chưa xem gì, không lỗi", () => {
    const st = parseReadSnapshot("garbage|{not json");
    expect(st.readKeys.size).toBe(0);
  });

  it("danh sách đã đọc giới hạn độ dài, giữ những key mới nhất", () => {
    let keys: string[] = [];
    for (let i = 0; i < READ_KEYS_CAP + 5; i++)
      keys = addReadKey(keys, `k-${i}`);
    expect(keys).toHaveLength(READ_KEYS_CAP);
    expect(keys.at(-1)).toBe(`k-${READ_KEYS_CAP + 4}`);
    expect(addReadKey(["a"], "a")).toEqual(["a"]);
  });
});
