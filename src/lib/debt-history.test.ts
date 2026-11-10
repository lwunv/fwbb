import { describe, it, expect } from "vitest";
import { findNegativeCrossings } from "./debt-history";

type Tx = {
  id: number;
  type: string;
  amount: number;
  reversalOfId?: number | null;
  createdAt: string;
  description?: string | null;
};

const tx = (
  id: number,
  type: string,
  amount: number,
  createdAt: string,
  extra: Partial<Tx> = {},
): Tx => ({ id, type, amount, createdAt, reversalOfId: null, ...extra });

describe("findNegativeCrossings", () => {
  it("ghi lại lần số dư chuyển từ ≥ 0 xuống < 0, kèm số dư lúc đó", () => {
    const r = findNegativeCrossings(7, [
      tx(1, "fund_contribution", 50_000, "2026-11-01 10:00:00"),
      tx(2, "fund_deduction", 80_000, "2026-11-02 21:00:00", {
        description: "Chốt sổ buổi 2026-11-02",
      }),
    ]);
    expect(r).toEqual([
      {
        memberId: 7,
        txId: 2,
        at: "2026-11-02 21:00:00",
        balanceBefore: 50_000,
        balanceAfter: -30_000,
        description: "Chốt sổ buổi 2026-11-02",
      },
    ]);
  });

  it("đang âm rồi âm thêm → không phải lần mới", () => {
    const r = findNegativeCrossings(7, [
      tx(1, "fund_deduction", 30_000, "2026-11-01 10:00:00"),
      tx(2, "fund_deduction", 40_000, "2026-11-02 10:00:00"),
    ]);
    expect(r.map((c) => c.txId)).toEqual([1]);
  });

  it("về ≥ 0 rồi âm lại → tính thêm một lần", () => {
    const r = findNegativeCrossings(7, [
      tx(1, "fund_deduction", 30_000, "2026-11-01 10:00:00"),
      tx(2, "fund_contribution", 30_000, "2026-11-02 10:00:00"),
      tx(3, "fund_deduction", 10_000, "2026-11-03 10:00:00"),
    ]);
    expect(r.map((c) => c.txId)).toEqual([1, 3]);
  });

  it("chốt sổ lại (đảo + ghi lại cùng thời điểm) khi đã âm → không đếm lần giả", () => {
    // Trước: +10K, chốt lần 1 trừ 30K → -20K (1 lần thật). Chốt lại: đảo +30K
    // rồi trừ lại 30K CÙNG giây. Xét từng dòng thì có lúc +10K rồi lại -20K.
    const r = findNegativeCrossings(7, [
      tx(1, "fund_contribution", 10_000, "2026-11-01 10:00:00"),
      tx(2, "fund_deduction", 30_000, "2026-11-02 21:00:00"),
      tx(3, "fund_contribution", 30_000, "2026-11-03 09:00:00", {
        reversalOfId: 2,
      }),
      tx(4, "fund_deduction", 30_000, "2026-11-03 09:00:00"),
    ]);
    expect(r.map((c) => c.txId)).toEqual([2]);
  });

  it("dòng audit (debt_created...) không đổi số dư → không ảnh hưởng", () => {
    const r = findNegativeCrossings(7, [
      tx(1, "debt_created", 99_000, "2026-11-01 10:00:00"),
      tx(2, "fund_contribution", 5_000, "2026-11-01 11:00:00"),
    ]);
    expect(r).toEqual([]);
  });
});
