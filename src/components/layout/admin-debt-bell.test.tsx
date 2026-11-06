// @vitest-environment jsdom
/**
 * Chuông admin cạnh logo (yêu cầu user 6/11/2026): số đỏ = mọi member đang âm
 * quỹ; bấm mở danh sách nhanh, có link sang trang thông báo. Render với vi.json
 * thật nên thiếu key dịch là đỏ.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
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

const action = vi.hoisted(() => ({
  getAdminDebtNotifications: vi.fn(),
}));
vi.mock("@/actions/admin-notifications", () => action);

const { AdminDebtBell } = await import("./admin-debt-bell");

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <AdminDebtBell />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AdminDebtBell", () => {
  afterEach(() => {
    cleanup();
    action.getAdminDebtNotifications.mockReset();
  });

  it("hiện số member đang âm quỹ, bấm mở danh sách tên + link xem tất cả", async () => {
    action.getAdminDebtNotifications.mockResolvedValue({
      owing: [
        {
          memberId: 56,
          name: "Nguyen Thanh",
          nickname: null,
          balance: -188_000,
          overLimit: true,
        },
        {
          memberId: 9,
          name: "Lan",
          nickname: null,
          balance: -7_000,
          overLimit: false,
        },
      ],
      history: [],
      voteBlockDebtThreshold: 100_000,
    });
    renderBell();
    const bell = await screen.findByRole("button", {
      name: /Thông báo.*2/,
    });
    fireEvent.click(bell);
    await waitFor(() => expect(screen.getByText("Nguyen Thanh")).toBeTruthy());
    expect(screen.getByText("Lan")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: viMessages.adminNotifications.viewAll,
    });
    expect(link.getAttribute("href")).toBe("/admin/notifications");
  });

  it("không ai âm quỹ → không có số đỏ", async () => {
    action.getAdminDebtNotifications.mockResolvedValue({
      owing: [],
      history: [],
      voteBlockDebtThreshold: 100_000,
    });
    renderBell();
    await waitFor(() =>
      expect(action.getAdminDebtNotifications).toHaveBeenCalled(),
    );
    expect(
      screen.getByRole("button", {
        name: viMessages.adminNotifications.bellLabel,
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-bell-badge")).toBeNull();
  });
});
