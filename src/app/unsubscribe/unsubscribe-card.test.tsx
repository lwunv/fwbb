// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const h = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: vi.fn() },
}));

const { UnsubscribeCard } = await import("./unsubscribe-card");
const t = viMessages.notifications.unsubscribe;
const TOKEN = "tok".padEnd(43, "A");

function setup(token: string) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <UnsubscribeCard token={token} />
    </NextIntlClientProvider>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  h.toastError.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UnsubscribeCard", () => {
  it("shows the result at once and POSTs the token", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    setup(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: t.button }));
    expect(screen.getByRole("heading", { name: t.doneTitle })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/notifications/unsubscribe?token=${TOKEN}`,
      { method: "POST" },
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("retries once, then rolls back to the button with an error toast", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }));
    setup(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: t.button }));
    await screen.findByRole("button", { name: t.button });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.toastError).toHaveBeenCalledWith(t.failed);
  });

  it("a transient failure that succeeds on retry stays done", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    setup(TOKEN);
    fireEvent.click(screen.getByRole("button", { name: t.button }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: t.doneTitle })).toBeTruthy();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("an empty token explains the link is invalid and links to /me instead of a dead button", () => {
    setup("");
    expect(screen.getByRole("heading", { name: t.invalidTitle })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.button })).toBeNull();
    const link = screen.getByRole("link", { name: t.openProfile });
    expect(link.getAttribute("href")).toBe("/me");
  });
});
