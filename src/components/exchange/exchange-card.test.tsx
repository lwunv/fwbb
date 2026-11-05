// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { ExchangeCard } from "./exchange-card";

afterEach(cleanup);

const card = {
  code: "abc123",
  title: "T",
  startAt: "2099-06-01T12:00:00.000Z",
  endAt: "2099-06-01T14:00:00.000Z",
  status: "open",
  skillMin: null,
  skillMax: null,
  slotsTotal: 10,
  venue: { id: 1, name: "Sân A", lat: 1, lng: 1, areaLabel: null },
  host: { name: "H", avatarUrl: null, avatarKey: null },
  fee: { kind: "fixed", male: 50000, female: 50000 },
  counts: { freeTotal: 5, freeFemaleOnly: 0 },
};

function text(distanceM: number | null) {
  const { container } = render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <ExchangeCard event={{ ...card, distanceM } as never} />
    </NextIntlClientProvider>,
  );
  return container.textContent ?? "";
}

describe("ExchangeCard distance", () => {
  it("a card with distanceM null renders no km", () => {
    expect(text(null)).not.toMatch(/km/);
  });

  it("a card with a known distance still renders it", () => {
    expect(text(2300)).toContain("2,3 km");
  });
});
