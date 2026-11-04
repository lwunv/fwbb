// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));

const { ZaloShareButton } = await import("./zalo-share-button");

function renderButton(zaloGroupUrl = "") {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <ZaloShareButton text="Nhắc vote: An, Bình" zaloGroupUrl={zaloGroupUrl} />
    </NextIntlClientProvider>,
  );
}

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  h.success.mockReset();
  h.error.mockReset();
  open = vi.fn();
  vi.stubGlobal("open", open);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
});

describe("ZaloShareButton", () => {
  it("share button falls back to clipboard when navigator.share is missing", async () => {
    renderButton("https://zalo.me/g/abc");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Nhắc vote: An, Bình"),
    );
    expect(h.success).toHaveBeenCalledWith(
      viMessages.notifications.share.copied,
    );
    expect(open).toHaveBeenCalledWith(
      "https://zalo.me/g/abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not open a group link when none is configured", async () => {
    renderButton("");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
  });

  it("uses navigator.share when available and skips the clipboard", async () => {
    const share = vi.fn<(data: { text: string }) => Promise<void>>(
      async () => {},
    );
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    renderButton("https://zalo.me/g/abc");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ text: "Nhắc vote: An, Bình" }),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("shows an error toast when the clipboard is refused", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    renderButton("");
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith(
        viMessages.notifications.share.copyFailed,
      ),
    );
  });

  it("opens the group inside the click itself, before the copy settles", () => {
    // Safari và trình duyệt trong app chặn window.open chạy sau một await.
    writeText.mockReturnValue(new Promise<void>(() => {}));
    renderButton("https://zalo.me/g/abc");
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith("Nhắc vote: An, Bình");
    expect(open).toHaveBeenCalledWith(
      "https://zalo.me/g/abc",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("the check mark goes back to the share icon after 2 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = renderButton("");
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(container.querySelector(".lucide-check")).toBeTruthy(),
      );
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(container.querySelector(".lucide-check")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
