// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Result = { success: true } | { error: string };

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  markRead: vi.fn(),
  markAll: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: vi.fn() },
}));
vi.mock("@/actions/notifications", () => ({
  getUnreadNotificationCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: h.markRead,
  markAllNotificationsRead: h.markAll,
}));

const { useNotificationActions } = await import("./use-notifications");

const LIST = ["notifications", "member", "list"];
const UNREAD = ["notifications", "member", "unread", "/"];

const item = (id: number, readAt: string | null = null) => ({
  id,
  kind: "session_opened" as const,
  entityType: "session" as const,
  entityId: 12,
  payload: { sessionDate: "2026-11-05", startTime: "20:30" },
  mandatory: false,
  readAt,
  createdAt: "2026-11-04T10:00:00.000Z",
});

function setup(items: ReturnType<typeof item>[], unread: number) {
  const qc = new QueryClient();
  qc.setQueryData(LIST, {
    pages: [{ items, nextCursor: null }],
    pageParams: [null],
  });
  qc.setQueryData(UNREAD, unread);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useNotificationActions("member"), {
    wrapper,
  });
  return { qc, actions: result.current };
}

const readMap = (qc: QueryClient) =>
  Object.fromEntries(
    (
      qc.getQueryData(LIST) as {
        pages: { items: { id: number; readAt: string | null }[] }[];
      }
    ).pages[0].items.map((it) => [it.id, it.readAt !== null]),
  );

function deferred() {
  const pending: ((r: Result) => void)[] = [];
  return {
    pending,
    impl: () =>
      new Promise<Result>((resolve) => {
        pending.push(resolve);
      }),
  };
}

beforeEach(() => {
  h.toastError.mockReset();
  h.markRead.mockReset();
  h.markAll.mockReset();
});

describe("useNotificationActions rollback", () => {
  it("a failed read reverts only that row and adds back one, keeping a concurrent read", async () => {
    const d = deferred();
    h.markRead.mockImplementation(d.impl);
    const { qc, actions } = setup([item(1), item(2), item(3)], 3);

    actions.markRead(item(1));
    actions.markRead(item(2));
    expect(qc.getQueryData(UNREAD)).toBe(1);

    d.pending[0]({ error: "boom" }); // tin 1 lỗi, fireAction thử lại
    await waitFor(() => expect(d.pending).toHaveLength(3));
    d.pending[2]({ error: "boom" });
    d.pending[1]({ success: true }); // tin 2 thành công
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom"));

    expect(readMap(qc)).toEqual({ 1: false, 2: true, 3: false });
    expect(qc.getQueryData(UNREAD)).toBe(2);
  });

  it("a failed mark-all reverts the rows it changed and restores the count", async () => {
    h.markAll.mockResolvedValue({ error: "boom" });
    const { qc, actions } = setup(
      [item(1), item(2, "2026-11-04T09:00:00.000Z")],
      1,
    );

    actions.markAll();
    expect(qc.getQueryData(UNREAD)).toBe(0);
    expect(readMap(qc)).toEqual({ 1: true, 2: true });

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom"));
    expect(readMap(qc)).toEqual({ 1: false, 2: true });
    expect(qc.getQueryData(UNREAD)).toBe(1);
  });
});
