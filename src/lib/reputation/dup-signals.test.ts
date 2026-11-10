import { describe, it, expect } from "vitest";
import { findDupSignalGroups, type DupSignalRow } from "./dup-signals";

const H = 3_600_000;
const T0 = Date.parse("2026-11-01T00:00:00Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function row(over: Partial<DupSignalRow> & { memberId: number }): DupSignalRow {
  return {
    ipHash: "net-a",
    kind: "login",
    firstSeenAt: at(0),
    lastSeenAt: at(0),
    name: `Người ${over.memberId}`,
    isExchange: true,
    ...over,
  };
}

const none = new Set<string>();
const pair = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

describe("findDupSignalGroups", () => {
  it("same name plus a shared network pairs an exchange account with a group member", () => {
    const groups = findDupSignalGroups(
      [
        row({ memberId: 7, name: "Nguyễn Văn An", isExchange: true }),
        // Khác dấu, hoa thường và khoảng trắng vẫn là một tên.
        row({ memberId: 3, name: "  nguyen van  AN ", isExchange: false }),
      ],
      none,
    );
    expect(groups).toEqual([
      {
        key: "same_name_network:3-7",
        reason: "same_name_network",
        memberIds: [3, 7],
      },
    ]);
  });

  it("same name on different networks, or a shared network with different names, is not a pair", () => {
    expect(
      findDupSignalGroups(
        [
          row({ memberId: 1, name: "An", ipHash: "net-a" }),
          row({ memberId: 2, name: "An", ipHash: "net-b" }),
        ],
        none,
      ),
    ).toEqual([]);
    expect(
      findDupSignalGroups(
        [
          row({ memberId: 1, name: "An", ipHash: "net-a" }),
          row({ memberId: 2, name: "Bình", ipHash: "net-a" }),
        ],
        none,
      ),
    ).toEqual([]);
  });

  it("names that fold to empty (Chinese, emoji only) never form a same-name pair", () => {
    expect(
      findDupSignalGroups(
        [
          row({ memberId: 1, name: "李明" }),
          row({ memberId: 2, name: "王芳" }),
          row({ memberId: 3, name: "😀🏸" }),
          row({ memberId: 4, name: "  " }),
        ],
        none,
      ),
    ).toEqual([]);
  });

  it("three exchange signups on one network within 24h form a burst; spread over three days they do not", () => {
    const burst = findDupSignalGroups(
      [
        row({ memberId: 5, kind: "signup", firstSeenAt: at(0) }),
        row({ memberId: 6, kind: "signup", firstSeenAt: at(10 * H) }),
        row({ memberId: 4, kind: "signup", firstSeenAt: at(23 * H) }),
      ],
      none,
    );
    expect(burst).toEqual([
      {
        key: "network_burst:4-5-6",
        reason: "network_burst",
        memberIds: [4, 5, 6],
      },
    ]);

    const spread = findDupSignalGroups(
      [
        row({ memberId: 5, kind: "signup", firstSeenAt: at(0) }),
        row({ memberId: 6, kind: "signup", firstSeenAt: at(25 * H) }),
        row({ memberId: 4, kind: "signup", firstSeenAt: at(50 * H) }),
      ],
      none,
    );
    expect(spread).toEqual([]);

    // Đăng nhập (không phải tạo tài khoản) và tài khoản nhóm không tính vào khung.
    expect(
      findDupSignalGroups(
        [
          row({ memberId: 5, kind: "signup", firstSeenAt: at(0) }),
          row({ memberId: 6, kind: "login", firstSeenAt: at(H) }),
          row({
            memberId: 4,
            kind: "signup",
            firstSeenAt: at(2 * H),
            isExchange: false,
          }),
        ],
        none,
      ),
    ).toEqual([]);
  });

  it("overlapping 24h windows on one network merge into one burst", () => {
    const groups = findDupSignalGroups(
      [1, 2, 3, 4].map((id) =>
        row({
          memberId: id,
          kind: "signup",
          firstSeenAt: at((id - 1) * 12 * H),
        }),
      ),
      none,
    );
    expect(groups.map((g) => g.memberIds)).toEqual([[1, 2, 3, 4]]);
  });

  it("two group members never form a group alone", () => {
    expect(
      findDupSignalGroups(
        [
          row({ memberId: 1, name: "An", isExchange: false }),
          row({ memberId: 2, name: "An", isExchange: false }),
          row({ memberId: 3, kind: "signup", isExchange: false }),
          row({ memberId: 4, kind: "signup", isExchange: false }),
          row({ memberId: 5, kind: "signup", isExchange: false }),
        ],
        none,
      ),
    ).toEqual([]);
  });

  it("ignored pairs drop out; a burst with every pair ignored disappears", () => {
    const sameName = [
      row({ memberId: 1, name: "An", isExchange: true }),
      row({ memberId: 2, name: "An", isExchange: false }),
      row({ memberId: 3, name: "An", isExchange: false }),
    ];
    expect(
      findDupSignalGroups(sameName, new Set([pair(1, 2)])).map(
        (g) => g.memberIds,
      ),
    ).toEqual([[1, 3]]);
    expect(
      findDupSignalGroups(sameName, new Set([pair(1, 2), pair(1, 3)])),
    ).toEqual([]);

    const burst = [7, 8, 9].map((id) =>
      row({ memberId: id, kind: "signup", firstSeenAt: at(id * H) }),
    );
    expect(
      findDupSignalGroups(burst, new Set([pair(7, 8), pair(7, 9), pair(8, 9)])),
    ).toEqual([]);
  });

  it("one pair seen on two networks is reported once, newest activity first", () => {
    const groups = findDupSignalGroups(
      [
        row({ memberId: 1, name: "An", ipHash: "net-a", lastSeenAt: at(H) }),
        row({ memberId: 2, name: "An", ipHash: "net-a", isExchange: false }),
        row({ memberId: 1, name: "An", ipHash: "net-b" }),
        row({ memberId: 2, name: "An", ipHash: "net-b", isExchange: false }),
        row({
          memberId: 5,
          name: "Bình",
          ipHash: "net-c",
          lastSeenAt: at(5 * H),
        }),
        row({ memberId: 6, name: "Binh", ipHash: "net-c", isExchange: false }),
      ],
      none,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "same_name_network:5-6",
      "same_name_network:1-2",
    ]);
  });
});
