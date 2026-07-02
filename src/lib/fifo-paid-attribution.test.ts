import { describe, it, expect } from "vitest";
import { attributePaidFifo } from "./fifo-paid-attribution";

const charges = [
  { sessionId: 1, date: "2026-06-22", totalAmount: 40000 },
  { sessionId: 2, date: "2026-06-24", totalAmount: 50000 },
  { sessionId: 3, date: "2026-06-26", totalAmount: 60000 },
];

describe("attributePaidFifo — deficit ăn vào buổi MỚI nhất trước", () => {
  it("balance >= 0 → tất cả paid", () => {
    expect(attributePaidFifo(charges, 0)).toEqual({
      1: "paid",
      2: "paid",
      3: "paid",
    });
    expect(attributePaidFifo(charges, 120000)).toEqual({
      1: "paid",
      2: "paid",
      3: "paid",
    });
  });

  it("âm 1 phần buổi mới nhất → partial, buổi cũ paid", () => {
    expect(attributePaidFifo(charges, -20000)).toEqual({
      1: "paid",
      2: "paid",
      3: "partial",
    });
  });

  it("âm đúng bằng buổi mới nhất → buổi đó unpaid", () => {
    expect(attributePaidFifo(charges, -60000)).toEqual({
      1: "paid",
      2: "paid",
      3: "unpaid",
    });
  });

  it("âm lan sang buổi giữa → newest unpaid, giữa partial", () => {
    // deficit 90K = 60K (s3) + 30K trong 50K (s2)
    expect(attributePaidFifo(charges, -90000)).toEqual({
      1: "paid",
      2: "partial",
      3: "unpaid",
    });
  });

  it("âm vượt tổng charge (nợ ngoài buổi chơi) → tất cả unpaid, không throw", () => {
    expect(attributePaidFifo(charges, -999000)).toEqual({
      1: "unpaid",
      2: "unpaid",
      3: "unpaid",
    });
  });

  it("input rỗng → object rỗng", () => {
    expect(attributePaidFifo([], -50000)).toEqual({});
  });

  it("charge 0 đồng (buổi free) không ăn deficit, luôn paid", () => {
    const withFree = [
      ...charges,
      { sessionId: 4, date: "2026-06-28", totalAmount: 0 },
    ];
    expect(attributePaidFifo(withFree, -60000)).toEqual({
      1: "paid",
      2: "paid",
      3: "unpaid",
      4: "paid",
    });
  });

  it("không phụ thuộc thứ tự input (sort nội bộ theo date desc, tie-break id desc)", () => {
    const shuffled = [charges[2], charges[0], charges[1]];
    expect(attributePaidFifo(shuffled, -20000)).toEqual({
      1: "paid",
      2: "paid",
      3: "partial",
    });
  });
});
