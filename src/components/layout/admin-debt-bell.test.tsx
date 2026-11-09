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

  // Quyết định user 9/11/2026: số trên chuông = số thông báo CHƯA ĐỌC (kiểu
  // Facebook), không còn là số người đang âm. Ca này không có lịch sử nên
  // chuông không có số; tìm chuông theo nhãn không số.
  it("bấm mở danh sách tên + link xem tất cả", async () => {
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
    await waitFor(() =>
      expect(action.getAdminDebtNotifications).toHaveBeenCalled(),
    );
    const bell = screen.getByRole("button", {
      name: viMessages.adminNotifications.bellLabel,
    });
    fireEvent.click(bell);
    await waitFor(() => expect(screen.getByText("Nguyen Thanh")).toBeTruthy());
    // Mở chuông là lấy lại 1 lần (chuông nằm trong layout, không unmount).
    await waitFor(() =>
      expect(action.getAdminDebtNotifications).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText("Lan")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: viMessages.adminNotifications.viewAll,
    });
    expect(link.getAttribute("href")).toBe("/admin/notifications");

    // Mỗi dòng là link tới sổ quỹ lọc sẵn tên; bấm thì đóng ngăn.
    const item = screen.getByRole("link", { name: /Nguyen Thanh/ });
    expect(item.getAttribute("href")).toBe(
      "/admin/fund/transactions?q=Nguyen%20Thanh",
    );
    item.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(item);
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
  });

  it("bấm chuông lần nữa thì đóng ngăn (bật/tắt)", async () => {
    action.getAdminDebtNotifications.mockResolvedValue({
      owing: [
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
    // Không có lịch sử → chuông không có số (số = tin chưa đọc từ 9/11/2026).
    const bell = await screen.findByRole("button", {
      name: viMessages.adminNotifications.bellLabel,
    });
    // Trước đây onClick luôn mở, nên bấm lần 2 ngăn vẫn mở (user 6/11/2026).
    fireEvent.pointerDown(bell);
    fireEvent.mouseDown(bell);
    fireEvent.click(bell);
    await waitFor(() => expect(screen.getByText("Lan")).toBeTruthy());
    expect(bell.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(bell);
    fireEvent.mouseDown(bell);
    fireEvent.click(bell);
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
    expect(bell.getAttribute("aria-expanded")).toBe("false");
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

  it("số trên chuông = số thông báo chưa đọc; đã xem hết thì không còn số", async () => {
    const recent = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * 60_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    action.getAdminDebtNotifications.mockResolvedValue({
      owing: [
        {
          memberId: 56,
          name: "Nguyen Thanh",
          nickname: null,
          balance: -188_000,
          overLimit: true,
        },
      ],
      history: [1, 2, 3].map((i) => ({
        memberId: 50 + i,
        txId: i,
        at: recent(i * 5),
        balanceBefore: 0,
        balanceAfter: -1_000,
        description: null,
        name: `M${i}`,
        nickname: null,
      })),
      voteBlockDebtThreshold: 100_000,
    });
    renderBell();
    const badge = await screen.findByTestId("admin-bell-badge");
    expect(badge.textContent).toBe("3");
    expect(
      screen.getByRole("button", { name: /Thông báo, 3 chưa đọc/ }),
    ).toBeTruthy();
    cleanup();
    window.localStorage.setItem(
      "fwbb.adminNotifications.lastSeenAt",
      new Date().toISOString(),
    );
    renderBell();
    await waitFor(() =>
      expect(action.getAdminDebtNotifications).toHaveBeenCalled(),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("admin-bell-badge")).toBeNull(),
    );
    window.localStorage.clear();
  });
});
