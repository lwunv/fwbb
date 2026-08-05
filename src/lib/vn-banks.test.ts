import { describe, expect, it } from "vitest";
import { VN_BANKS, findBankByBin } from "./vn-banks";

describe("VN_BANKS", () => {
  it("mọi BIN đúng 6 chữ số", () => {
    for (const bank of VN_BANKS) {
      expect(bank.bin).toMatch(/^\d{6}$/);
    }
  });

  it("không có BIN nào trùng nhau", () => {
    const bins = VN_BANKS.map((b) => b.bin);
    expect(new Set(bins).size).toBe(bins.length);
  });

  it("có ít nhất một ngân hàng transferSupported (cần cho dropdown)", () => {
    expect(VN_BANKS.some((b) => b.transferSupported)).toBe(true);
  });
});

describe("findBankByBin", () => {
  it("tra đúng ngân hàng theo BIN", () => {
    const bank = findBankByBin("970454");
    expect(bank?.shortName).toBe("VietCapitalBank");
  });

  it("trả undefined cho BIN lạ không có trong danh sách", () => {
    expect(findBankByBin("000000")).toBeUndefined();
  });
});
