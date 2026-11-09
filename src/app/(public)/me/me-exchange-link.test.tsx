// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { MeExchangeLink } from "./me-exchange-link";

afterEach(cleanup);

describe("MeExchangeLink", () => {
  it("MeExchangeLink renders nothing when disabled", () => {
    const { container } = render(<MeExchangeLink enabled={false} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("MeExchangeLink enabled", () => {
  it("me page link only when enabled", () => {
    const { container } = render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <MeExchangeLink enabled />
      </NextIntlClientProvider>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("/exchanges/mine");
    expect(a?.textContent).toContain("Giao lưu của tôi");
  });
});
