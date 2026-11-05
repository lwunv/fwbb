// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MeExchangeLink } from "./me-exchange-link";

afterEach(cleanup);

describe("MeExchangeLink", () => {
  it("MeExchangeLink renders nothing when disabled", () => {
    const { container } = render(<MeExchangeLink enabled={false} />);
    expect(container.innerHTML).toBe("");
  });
});
