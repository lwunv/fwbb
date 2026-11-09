// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { VenueShareButton } from "./venue-share-button";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const shareMock = vi.hoisted(() => ({ shareOrCopy: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/share-link", () => shareMock);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function renderButton() {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueShareButton venueId={7} name="Sân Cầu Giấy" />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Chia sẻ" });
}

describe("VenueShareButton", () => {
  it("failed share shows the error toast; shared and cancelled show nothing", async () => {
    const button = renderButton();
    shareMock.shareOrCopy.mockResolvedValueOnce("failed");
    fireEvent.click(button);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Không chia sẻ được. Bạn thử lại nhé.",
      ),
    );
    expect(shareMock.shareOrCopy).toHaveBeenCalledWith({
      title: "Sân Cầu Giấy",
      url: `${window.location.origin}/venues/7`,
    });

    shareMock.shareOrCopy.mockResolvedValueOnce("shared");
    fireEvent.click(button);
    shareMock.shareOrCopy.mockResolvedValueOnce("cancelled");
    fireEvent.click(button);
    await waitFor(() => expect(shareMock.shareOrCopy).toHaveBeenCalledTimes(3));
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("is a 44px target whose name stays Chia sẻ when only the icon shows", () => {
    const button = renderButton();
    const classes = (button.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("size-11");
    // Chữ chỉ hiện từ md:, dưới đó vẫn còn cho trình đọc màn hình.
    const label = screen.getByText("Chia sẻ");
    expect(label.getAttribute("class")).toContain("sr-only");
    expect(label.getAttribute("class")).toContain("md:not-sr-only");
  });
});
