import { describe, it, expect } from "vitest";
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
