// @vitest-environment jsdom
/**
 * Trang thông báo admin kiểu Facebook (yêu cầu user 6/11/2026): tab, tìm,
 * lọc, "Xem thêm", đánh dấu đã xem. Render với vi.json thật.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import viMessages from "@/i18n/messages/vi.json";
import { NotificationsClient } from "./notifications-client";

const vn = viMessages.adminNotifications;

/** created_at SQLite (UTC) cách bây giờ `minutesAgo` phút. */
function at(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

const history = Array.from({ length: 25 }, (_, i) => ({
  memberId: i + 1,
  txId: i + 1,
  at: at(i * 10),
  balanceBefore: 0,
  balanceAfter: -1_000 * (i + 1),
  description: null,
  name: i === 0 ? "Nguyen Thanh" : `Member ${i + 1}`,
  nickname: null,
  avatarKey: null,
  avatarUrl: null,
}));
const owing = [
  {
    memberId: 1,
    name: "Nguyen Thanh",
    nickname: null,
    avatarKey: null,
    avatarUrl: null,
    balance: -188_000,
    overLimit: true,
  },
  {
    memberId: 2,
    name: "Lan",
    nickname: null,
    avatarKey: null,
    avatarUrl: null,
    balance: -7_000,
    overLimit: false,
  },
];

function renderPage() {
  render(
    <NuqsTestingAdapter>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <NotificationsClient
          owing={owing}
          history={history}
          voteBlockDebtThreshold={100_000}
        />
      </NextIntlClientProvider>
    </NuqsTestingAdapter>,
  );
}

const activityItems = () =>
  screen.getAllByText(vn.crossedNegative, { exact: false });

describe("NotificationsClient", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("tab Hoạt động: hiện 20 dòng đầu, 'Xem thêm' mở thêm phần còn lại", () => {
    renderPage();
    expect(activityItems()).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: vn.loadMore }));
    expect(activityItems()).toHaveLength(25);
    expect(screen.queryByRole("button", { name: vn.loadMore })).toBeNull();
  });

  it("tìm theo tên lọc dòng thời gian", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(vn.searchPlaceholder), {
      target: { value: "thanh" },
    });
    // nuqs ghi URL bất đồng bộ (gom nhịp), chờ danh sách lọc xong.
    await waitFor(() => expect(activityItems()).toHaveLength(1));
  });

  it("tab Đang nợ + lọc 'Quá hạn mức' chỉ còn người vượt hạn mức", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(vn.tabOwing) }));
    fireEvent.click(await screen.findByRole("tab", { name: vn.levelOver }));
    await waitFor(() => {
      const list = screen.getByRole("list");
      expect(within(list).getByText("Nguyen Thanh")).toBeTruthy();
      expect(within(list).queryByText("Lan")).toBeNull();
    });
  });

  it("chưa xem lần nào → có chấm chưa xem; bấm 'Đánh dấu đã xem' → hết", () => {
    renderPage();
    expect(screen.getAllByLabelText(vn.unread).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: vn.markAllSeen }));
    expect(screen.queryAllByLabelText(vn.unread)).toHaveLength(0);
  });
});

describe("NotificationsClient — lọc ngày mà trống", () => {
  afterEach(cleanup);

  it("không nói 'chưa ai từng âm quỹ', có nút xem tất cả", async () => {
    const old = history
      .slice(0, 2)
      .map((h) => ({ ...h, at: at(60 * 24 * 60) }));
    render(
      <NuqsTestingAdapter>
        <NextIntlClientProvider locale="vi" messages={viMessages}>
          <NotificationsClient
            owing={owing}
            history={old}
            voteBlockDebtThreshold={100_000}
          />
        </NextIntlClientProvider>
      </NuqsTestingAdapter>,
    );
    expect(screen.queryByText(vn.historyEmpty)).toBeNull();
    expect(
      screen.getByText(vn.historyEmptyRange.replace("{days}", "30")),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: vn.rangeAll }));
    await waitFor(() => expect(activityItems()).toHaveLength(2));
  });
});
