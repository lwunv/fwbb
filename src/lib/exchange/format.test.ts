import { describe, it, expect, vi } from "vitest";
import { exchangeFeeText, exchangeWhenLabel, shortMoney } from "./format";
import type { ExchangeCard } from "./public-event";

const t = (key: string, v: Record<string, string>) =>
  `${key}:${Object.values(v).join("/")}`;
const rates = { male: 80000, female: 60000 };
const fee = (f: unknown) => f as ExchangeCard["fee"];

describe("format", () => {
  it("fee text and when label match what ExchangeCard showed", () => {
    expect(shortMoney(80000)).toBe("80K");
    expect(shortMoney(80500)).not.toBe("80K");
    expect(
      exchangeFeeText(fee({ kind: "fixed", male: 80000, female: 80000 }), t),
    ).toBe("80K");
    expect(
      exchangeFeeText(fee({ kind: "fixed", male: 80000, female: 60000 }), t),
    ).toBe("feeGender:80K/60K");
    expect(
      exchangeFeeText(
        fee({ kind: "split", estimate: rates, estimateIsCap: true }),
        t,
      ),
    ).toBe("feeCap:80K");
    expect(
      exchangeFeeText(
        fee({ kind: "split", estimate: rates, estimateIsCap: false }),
        t,
      ),
    ).toBe("feeAbout:80K");
    expect(exchangeFeeText(fee({ kind: "locked", rates }), t)).toBe(
      "feeLocked:80K",
    );
    // 12:00Z = 19:00 giờ Việt Nam
    expect(
      exchangeWhenLabel(
        "2026-11-09T12:00:00.000Z",
        "2026-11-09T14:00:00.000Z",
        "vi",
      ),
    ).toContain("19:00-21:00");
  });
});

describe("exchangeWhenLabel is the same on server and browser", () => {
  // Node ICU viết thứ tiếng Việt là "Th 4", Chrome viết "Thứ 4": thẻ giao lưu
  // render ở server (trang chi tiết sân) lệch hydrate (React #418). Nhãn phải
  // dựng từ bảng cố định, không qua Intl.
  const start = "2026-11-11T12:30:00.000Z"; // Thứ 4, 19:30 giờ VN
  const end = "2026-11-11T14:30:00.000Z";

  it("formats each locale from fixed tables in Vietnam time", () => {
    expect(exchangeWhenLabel(start, end, "vi")).toBe("T4, 11/11, 19:30-21:30");
    expect(exchangeWhenLabel(start, end, "en")).toBe("Wed, 11/11, 19:30-21:30");
    expect(exchangeWhenLabel(start, end, "zh")).toBe("11/11 周三, 19:30-21:30");
    // 17:30Z Chủ nhật = 00:30 thứ Hai giờ VN.
    expect(
      exchangeWhenLabel(
        "2026-11-08T17:30:00.000Z",
        "2026-11-08T19:00:00.000Z",
        "vi",
      ),
    ).toBe("T2, 09/11, 00:30-02:00");
  });

  it("does not depend on the runtime's Intl data", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl must not be used");
    });
    expect(exchangeWhenLabel(start, end, "vi")).toBe("T4, 11/11, 19:30-21:30");
    spy.mockRestore();
  });
});
