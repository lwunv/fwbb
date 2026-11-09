// @vitest-environment jsdom
/**
 * Nút chọn sân là `button`, không hỗ trợ `aria-invalid` (jsx-a11y). Lỗi phải
 * nối vào nút qua `aria-describedby` để trình đọc màn hình vẫn đọc được.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("@/actions/venues", () => ({ listVenuesNear: vi.fn() }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/venues/use-user-location", () => ({
  useUserLocation: () => ({ status: "idle", position: null, request: vi.fn() }),
}));

const { VenuePicker } = await import("./venue-picker");

afterEach(cleanup);

function renderPicker(invalid: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <VenuePicker
          value={null}
          onChange={() => {}}
          invalid={invalid}
          errorId="venue-error"
        />
        <p id="venue-error">{viMessages.exchange.form.fieldVenue}</p>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return screen.getAllByRole("button")[0];
}

describe("VenuePicker", () => {
  it("links the error through aria-describedby instead of aria-invalid on the button", () => {
    const btn = renderPicker(true);
    expect(btn.getAttribute("aria-invalid")).toBeNull();
    expect(btn.getAttribute("aria-describedby")).toBe("venue-error");
    cleanup();
    const ok = renderPicker(false);
    expect(ok.getAttribute("aria-describedby")).toBeNull();
  });
});
