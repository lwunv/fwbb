import { describe, it, expect } from "vitest";
import {
  filterOwing,
  filterHistory,
  groupByRecency,
  ledgerTimeToDate,
} from "./admin-notifications-view";

const owing = [
  {
    memberId: 1,
    name: "Nguyễn Thanh",
    nickname: null,
    balance: -188_000,
    overLimit: true,
  },
  {
    memberId: 2,
    name: "Khánh Huân",
    nickname: "Huân dz",
    balance: -44_000,
    overLimit: false,
  },
  {
    memberId: 3,
    name: "Đỗ thành long",
    nickname: null,
    balance: -39_000,
    overLimit: false,
  },
];

describe("filterOwing", () => {
  it("tìm không dấu, khớp cả biệt danh", () => {
    expect(
      filterOwing(owing, { q: "thanh", level: "all" }).map((o) => o.memberId),
    ).toEqual([1, 3]);
    expect(
      filterOwing(owing, { q: "dz", level: "all" }).map((o) => o.memberId),
    ).toEqual([2]);
  });
  it("lọc quá hạn mức / dưới hạn mức", () => {
    expect(
      filterOwing(owing, { q: "", level: "over" }).map((o) => o.memberId),
    ).toEqual([1]);
    expect(
      filterOwing(owing, { q: "", level: "under" }).map((o) => o.memberId),
    ).toEqual([2, 3]);
  });
});

// `at` là created_at SQLite (UTC, "YYYY-MM-DD HH:MM:SS").
const NOW = new Date("2026-11-06T05:00:00Z"); // 12:00 giờ VN ngày 6/11
const h = (memberId: number, at: string, name = "A") => ({
  memberId,
  txId: memberId,
  at,
  balanceBefore: 0,
  balanceAfter: -1_000,
  description: null,
  name,
  nickname: null,
});

describe("filterHistory", () => {
  const items = [
    h(1, "2026-11-06 01:00:00", "Thanh"), // hôm nay
    h(2, "2026-10-20 01:00:00", "Lan"), // 17 ngày trước
    h(3, "2026-06-01 01:00:00", "Thanh"), // rất cũ
  ];
  it("lọc theo số ngày gần đây", () => {
    expect(
      filterHistory(items, { q: "", rangeDays: 7, now: NOW }).map(
        (x) => x.memberId,
      ),
    ).toEqual([1]);
    expect(
      filterHistory(items, { q: "", rangeDays: 30, now: NOW }).map(
        (x) => x.memberId,
      ),
    ).toEqual([1, 2]);
    expect(
      filterHistory(items, { q: "", rangeDays: null, now: NOW }),
    ).toHaveLength(3);
  });
  it("tìm theo tên", () => {
    expect(
      filterHistory(items, { q: "thanh", rangeDays: null, now: NOW }).map(
        (x) => x.memberId,
      ),
    ).toEqual([1, 3]);
  });
});

describe("groupByRecency (theo ngày giờ VN)", () => {
  it("chia Hôm nay / Hôm qua / Tuần này / Trước đó, giữ thứ tự", () => {
    const items = [
      h(1, "2026-11-05 18:00:00"), // 01:00 ngày 6/11 giờ VN → hôm nay
      h(2, "2026-11-05 10:00:00"), // 17:00 ngày 5/11 giờ VN → hôm qua
      h(3, "2026-11-02 10:00:00"), // 4 ngày trước → tuần này
      h(4, "2026-10-01 10:00:00"), // → trước đó
    ];
    expect(
      groupByRecency(items, NOW).map((g) => [
        g.key,
        g.items.map((x) => x.memberId),
      ]),
    ).toEqual([
      ["today", [1]],
      ["yesterday", [2]],
      ["week", [3]],
      ["earlier", [4]],
    ]);
  });
  it("bỏ nhóm rỗng", () => {
    expect(
      groupByRecency([h(4, "2026-10-01 10:00:00")], NOW).map((g) => g.key),
    ).toEqual(["earlier"]);
  });
});

describe("ledgerTimeToDate", () => {
  it("đọc created_at SQLite như UTC", () => {
    expect(ledgerTimeToDate("2026-11-05 18:00:00").toISOString()).toBe(
      "2026-11-05T18:00:00.000Z",
    );
  });
});
