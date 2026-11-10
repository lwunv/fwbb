// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { OpenStatus } from "@/lib/venues/open-hours";
import { VenueOpenStatus } from "./venue-open-status";

let visibility: DocumentVisibilityState = "visible";
// Gốc hydrate tự dựng (ngoài RTL) phải được gỡ cả khi test hỏng giữa chừng.
let hydrated: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
});
afterEach(() => {
  if (hydrated) {
    const { root, container } = hydrated;
    act(() => root.unmount());
    container.remove();
    hydrated = null;
  }
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

function tree(hours: string, initialStatus: OpenStatus) {
  return (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VenueOpenStatus hours={hours} initialStatus={initialStatus} />
    </NextIntlClientProvider>
  );
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("VenueOpenStatus", () => {
  it("first paint equals the server output, then a tab restored at 23:30 VN shows Đã đóng", () => {
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z")); // server render, 10:00 VN
    const html = renderToString(tree("5:00 - 23:00", "open"));
    expect(html).toContain("Đang mở (5:00 - 23:00)");

    // Zalo khôi phục tab sau nhiều giờ: đồng hồ đã chạy trước khi hydrate.
    vi.setSystemTime(new Date("2026-11-09T16:30:00Z")); // 23:30 VN
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    act(() => {
      hydrated = {
        root: hydrateRoot(container, tree("5:00 - 23:00", "open"), {
          onRecoverableError,
        }),
        container,
      };
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Đang mở (5:00 - 23:00)");

    setVisibility("visible");
    expect(container.textContent).toBe("Đã đóng (5:00 - 23:00)");
  });

  it("while the tab is visible it rechecks every minute, so 23:00 VN flips to Đã đóng without any event", () => {
    vi.setSystemTime(new Date("2026-11-09T15:59:30Z")); // 22:59:30 VN
    render(tree("5:00 - 23:00", "open"));
    expect(screen.getByText("Đang mở (5:00 - 23:00)")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Đã đóng (5:00 - 23:00)")).toBeTruthy();
  });

  it("a stale status from a cached page is corrected right after mount", () => {
    vi.setSystemTime(new Date("2026-11-09T16:30:00Z")); // 23:30 VN
    render(tree("5:00 - 23:00", "open"));
    // Lần vẽ đầu vẫn là thứ server gửi, sửa ngay sau khi gắn.
    expect(screen.getByText("Đang mở (5:00 - 23:00)")).toBeTruthy();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(screen.getByText("Đã đóng (5:00 - 23:00)")).toBeTruthy();
  });

  it("hidden tabs keep no timer, and unparseable hours never start one", () => {
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z"));
    render(tree("5:00 - 23:00", "open"));
    expect(vi.getTimerCount()).toBe(1);
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);

    render(tree("T2-T6 5:00-22:00", "unknown"));
    expect(screen.getByText("Chưa rõ giờ (T2-T6 5:00-22:00)")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByText("Chưa rõ giờ (T2-T6 5:00-22:00)")).toBeTruthy();
  });
});
