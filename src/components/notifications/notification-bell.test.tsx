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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";

const h = vi.hoisted(() => ({
  isMobile: false,
  push: vi.fn(),
  toastError: vi.fn(),
  count: vi.fn(),
  list: vi.fn(),
  markRead: vi.fn(),
  markAll: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: h.push }),
}));
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: vi.fn() },
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => h.isMobile }));
vi.mock("@/actions/notifications", () => ({
  getUnreadNotificationCount: h.count,
  listNotifications: h.list,
  markNotificationRead: h.markRead,
  markAllNotificationsRead: h.markAll,
}));

const { NotificationBell } = await import("./notification-bell");

const item = (over: Record<string, unknown> = {}) => ({
  id: 7,
  kind: "session_opened",
  entityType: "session",
  entityId: 12,
  payload: { sessionDate: "2026-11-05", startTime: "20:30" },
  mandatory: false,
  readAt: null,
  createdAt: "2026-11-04T10:00:00.000Z",
  ...over,
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <NotificationBell scope="member" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  h.isMobile = false;
  h.push.mockReset();
  h.toastError.mockReset();
  h.count.mockReset().mockResolvedValue(3);
  h.list.mockReset().mockResolvedValue({ items: [item()], nextCursor: null });
  h.markRead.mockReset().mockResolvedValue({ success: true });
  h.markAll.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => cleanup());

const bellButton = () =>
  screen.getByRole("button", {
    name: new RegExp(viMessages.notifications.bell.title),
  });

describe("NotificationBell", () => {
  it("bell shows 99+ when count is 100", async () => {
    h.count.mockResolvedValue(100);
    setup();
    expect(await screen.findByText("99+")).toBeTruthy();
  });

  it("clicking an unread row marks it read optimistically and rolls back on error", async () => {
    h.markRead.mockResolvedValue({ error: "boom" });
    const qc = setup();
    await screen.findByText("3");
    fireEvent.click(bellButton());
    const title = await screen.findByText(
      viMessages.notifications.kinds.session_opened.title,
    );
    const readAt = () =>
      (
        qc.getQueryData(["notifications", "member", "list"]) as {
          pages: { items: { readAt: string | null }[] }[];
        }
      ).pages[0].items[0].readAt;
    expect(readAt()).toBeNull();

    fireEvent.click(title);
    // Optimistic: đổi ngay, trước khi server trả lời.
    expect(readAt()).not.toBeNull();
    expect(h.push).toHaveBeenCalledWith("/vote/12");

    // Server lỗi (fireAction thử lại 1 lần) thì trả về chưa đọc và báo lỗi.
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom"));
    expect(readAt()).toBeNull();
    const unread = qc.getQueriesData<number>({
      queryKey: ["notifications", "member", "unread"],
    });
    expect(unread[0][1]).toBe(3);
  });

  it("mobile renders a bottom sheet, desktop a dialog", async () => {
    h.isMobile = true;
    setup();
    fireEvent.click(bellButton());
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="sheet-content"]'),
      ).toBeTruthy(),
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    cleanup();

    h.isMobile = false;
    setup();
    fireEvent.click(bellButton());
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="dialog-content"]'),
      ).toBeTruthy(),
    );
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });
});
