import { describe, it, expect } from "vitest";
import { getVietQRUrl } from "./vietqr";

describe("getVietQRUrl", () => {
  it("should generate basic VietQR URL with all params", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "1111111111",
      accountName: "NGUYEN VAN A",
      amount: 150000,
      memo: "FWBB QUY THANG 4",
    });

    expect(url).toContain(
      "https://img.vietqr.io/image/970454-1111111111-compact2.png",
    );
    expect(url).toContain("amount=150000");
    expect(url).toContain("addInfo=FWBB+QUY+THANG+4");
    expect(url).toContain("accountName=NGUYEN+VAN+A");
  });

  it("should use custom template", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "123",
      accountName: "TEST",
      amount: 100000,
      memo: "test",
      template: "qr_only",
    });

    expect(url).toContain("-qr_only.png");
  });

  it("should default to compact2 template", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "123",
      accountName: "TEST",
      amount: 100000,
      memo: "test",
    });

    expect(url).toContain("-compact2.png");
  });

  it("should omit amount when 0", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "123",
      accountName: "TEST",
      amount: 0,
      memo: "test",
    });

    expect(url).not.toContain("amount=");
  });

  it("should handle empty memo", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "123",
      accountName: "TEST",
      amount: 100000,
      memo: "",
    });

    expect(url).not.toContain("addInfo=");
  });

  it("should URL-encode special characters in memo", () => {
    const url = getVietQRUrl({
      bankBin: "970454",
      accountNo: "123",
      accountName: "TEST",
      amount: 100000,
      memo: "BUỔI 15/04",
    });

    expect(url).toContain("addInfo=");
    // Ensure URL-encoded properly
    expect(() => new URL(url)).not.toThrow();
  });

  it("should escape bankBin/accountNo containing URL-breaking characters (env fallback defense-in-depth)", () => {
    const url = getVietQRUrl({
      bankBin: "970454/evil",
      accountNo: "123?a=1#b",
      accountName: "TEST",
      amount: 100000,
      memo: "test",
    });

    expect(url).toContain(
      `${encodeURIComponent("970454/evil")}-${encodeURIComponent("123?a=1#b")}-compact2.png`,
    );
    expect(() => new URL(url)).not.toThrow();
  });
});
