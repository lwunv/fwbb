import { describe, it, expect } from "vitest";
import { findCaptiveHosts, type CaptiveRow } from "./host-flags";

// Một dòng = một lần điểm danh hợp lệ của `memberId` ở buổi `eventId` do `hostId` tổ chức.
const at = (
  hostId: number,
  eventId: number,
  memberId: number,
  memberApproved = false,
): CaptiveRow => ({ hostId, eventId, memberId, memberApproved });

/** `n` buổi của host `hostId`, id buổi bắt đầu từ `firstEvent`, cùng một member. */
const series = (
  hostId: number,
  firstEvent: number,
  n: number,
  memberId: number,
  memberApproved = false,
): CaptiveRow[] =>
  Array.from({ length: n }, (_, i) =>
    at(hostId, firstEvent + i, memberId, memberApproved),
  );

/** Ba member chỉ đi buổi của host 1 (đủ cờ), cộng thêm `extra`. */
const flaggedBase = (members: number[]): CaptiveRow[] =>
  members.flatMap((m) => series(1, 100, 3, m));

describe("findCaptiveHosts", () => {
  it("a pending member checked in at 3 of one host's events and nowhere else is captive", () => {
    const rows = [...series(1, 100, 3, 50), ...flaggedBase([51, 52])];
    expect(findCaptiveHosts(rows)).toEqual([
      { hostId: 1, captives: 3, events: 3 },
    ]);
    // Chỉ 2 buổi với host: chưa đủ HOST_FLAG_MIN_EVENTS.
    const two = [...series(1, 100, 2, 50), ...flaggedBase([51, 52])];
    expect(findCaptiveHosts(two)).toEqual([]);
  });

  it("an approved group member is never captive", () => {
    const rows = [...series(1, 100, 5, 50, true), ...flaggedBase([51, 52])];
    expect(findCaptiveHosts(rows)).toEqual([]);
  });

  it("4 of 5 check-ins with the host is captive, 3 of 5 is not", () => {
    const four = [
      ...series(1, 100, 4, 50),
      at(2, 200, 50),
      ...flaggedBase([51, 52]),
    ];
    expect(findCaptiveHosts(four)).toEqual([
      { hostId: 1, captives: 3, events: 4 },
    ]);
    const three = [
      ...series(1, 100, 3, 50),
      ...series(2, 200, 2, 50),
      ...flaggedBase([51, 52]),
    ];
    expect(findCaptiveHosts(three)).toEqual([]);
  });

  it("three captives flag the host, two do not", () => {
    expect(findCaptiveHosts(flaggedBase([50, 51]))).toEqual([]);
    expect(findCaptiveHosts(flaggedBase([50, 51, 52]))).toEqual([
      { hostId: 1, captives: 3, events: 3 },
    ]);
  });

  it("duplicate rows count once", () => {
    // Member 52 có 2 buổi, lặp 3 lần mỗi dòng: vẫn là 2 buổi, không thành khách quen.
    const dup = [
      ...flaggedBase([50, 51]),
      ...series(1, 100, 2, 52),
      ...series(1, 100, 2, 52),
      ...series(1, 100, 2, 52),
    ];
    expect(findCaptiveHosts(dup)).toEqual([]);
    // Dòng ngoài host bị lặp không làm tăng mẫu số: 4/5 vẫn đạt.
    const outside = [
      ...series(1, 100, 4, 53),
      at(2, 200, 53),
      at(2, 200, 53),
      ...flaggedBase([51, 52]),
    ];
    expect(findCaptiveHosts(outside)).toEqual([
      { hostId: 1, captives: 3, events: 4 },
    ]);
    const rows = [...flaggedBase([50, 51, 52]), ...flaggedBase([50, 51, 52])];
    expect(findCaptiveHosts(rows)).toEqual([
      { hostId: 1, captives: 3, events: 3 },
    ]);
  });

  it("the host is never a captive of their own events and hosts sort by captives then id", () => {
    const rows = [
      // Host 2: 4 khách quen.
      ...[60, 61, 62, 63].flatMap((m) => series(2, 300, 3, m)),
      // Host 1: 3 khách quen, cộng chính host 1 có mặt ở buổi của mình.
      ...flaggedBase([50, 51, 52]),
      ...series(1, 100, 3, 1),
      // Host 3: 3 khách quen, id lớn hơn host 1.
      ...[70, 71, 72].flatMap((m) => series(3, 400, 3, m)),
    ];
    expect(findCaptiveHosts(rows)).toEqual([
      { hostId: 2, captives: 4, events: 3 },
      { hostId: 1, captives: 3, events: 3 },
      { hostId: 3, captives: 3, events: 3 },
    ]);
  });

  it("events counts the host's distinct events with at least one captive", () => {
    const rows = [
      ...series(1, 100, 3, 50),
      ...series(1, 102, 3, 51),
      ...series(1, 104, 3, 52),
      // Buổi 110 chỉ có member approved: không tính.
      at(1, 110, 90, true),
    ];
    expect(findCaptiveHosts(rows)).toEqual([
      { hostId: 1, captives: 3, events: 7 },
    ]);
  });
});
