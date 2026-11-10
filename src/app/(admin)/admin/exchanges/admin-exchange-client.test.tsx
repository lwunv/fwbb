// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  configure,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";

configure({ asyncUtilTimeout: 3000 });

const admin = vi.hoisted(() => ({
  adminCancelExchange: vi.fn(),
  adminListExchanges: vi.fn(),
  adminListReports: vi.fn(),
  adminResolveReport: vi.fn(),
  adminSetExchangeHidden: vi.fn(),
  adminListComments: vi.fn(),
  adminModerateComment: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/actions/exchange-admin", () => admin);
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const { AdminExchangeClient, ReputationPanelSkeleton } =
  await import("./admin-exchange-client");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const comment = (over: Record<string, unknown>) => ({
  id: 1,
  eventCode: "abc123",
  eventTitle: "Buổi tối thứ 4",
  channel: "qa",
  authorName: "Lan",
  authorIsHost: false,
  body: "<b>xin chào</b>",
  status: "held",
  openReports: 0,
  createdAt: "2099-06-01T12:00:00.000Z",
  ...over,
});

function mount(reports: unknown[] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <AdminExchangeClient
          initialEvents={[]}
          initialReports={reports as never}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function listBy(filter: string) {
  if (filter === "held")
    return [
      comment({ id: 1, status: "held" }),
      comment({ id: 2, status: "held", authorIsHost: true, authorName: "Hoa" }),
    ];
  if (filter === "hidden")
    return [comment({ id: 3, status: "hidden", openReports: 2 })];
  return [comment({ id: 4, status: "visible", openReports: 3 })];
}

describe("admin comments tab", () => {
  beforeEach(() => {
    admin.adminListComments.mockImplementation(async (f: string) => ({
      success: true,
      data: listBy(f),
    }));
  });

  it("admin comments tab lists held, hidden and reported and approves optimistically", async () => {
    let resolveMod: (v: unknown) => void = () => {};
    admin.adminModerateComment.mockReturnValue(
      new Promise((r) => (resolveMod = r)),
    );
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Bình luận/ }));

    // Chờ duyệt (mặc định): tên buổi, tác giả, nhãn Host, nội dung chữ thuần.
    expect(await screen.findAllByText("Buổi tối thứ 4")).toHaveLength(2);
    expect(screen.getByText("Lan")).toBeTruthy();
    expect(screen.getByText("Host")).toBeTruthy();
    expect(screen.getAllByText("<b>xin chào</b>").length).toBe(2);
    expect(document.querySelector("b")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Duyệt" })[0]);
    // Lạc quan: dòng biến mất trước khi server trả lời.
    // (exit animation keeps the node a few frames)
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
    expect(resolveMod).toBeDefined();
    expect(admin.adminModerateComment).toHaveBeenCalledWith({
      commentId: 1,
      action: "approve",
    });
    resolveMod({ success: true });

    fireEvent.click(screen.getByRole("tab", { name: "Đang ẩn" }));
    expect(await screen.findByText("2 báo cáo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bỏ ẩn" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Bị báo cáo" }));
    expect(await screen.findByText("3 báo cáo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bỏ qua báo cáo" })).toBeTruthy();
  });

  it("admin unhide rolls back on error", async () => {
    admin.adminModerateComment.mockResolvedValue({ error: "nope" });
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Bình luận/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Đang ẩn" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ ẩn" }));
    await waitFor(() => expect(screen.queryByText("2 báo cáo")).toBeNull());
    expect(admin.adminModerateComment).toHaveBeenCalledWith({
      commentId: 3,
      action: "unhide",
    });
    expect(await screen.findByText("2 báo cáo")).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith("nope");
    // retry: false, đúng một lần gọi.
    expect(admin.adminModerateComment).toHaveBeenCalledTimes(1);
  });
});

describe("admin comment safeguards", () => {
  it("delete asks for confirmation first and only then moderates", async () => {
    admin.adminListComments.mockImplementation(async (f: string) => ({
      success: true,
      data: listBy(f),
    }));
    admin.adminModerateComment.mockResolvedValue({ success: true });
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Bình luận/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Xoá" }))[0]);
    expect(
      await screen.findByText("Xoá bình luận này? Không hoàn tác được."),
    ).toBeTruthy();
    expect(admin.adminModerateComment).not.toHaveBeenCalled();
    const sheetButtons = screen.getAllByRole("button", { name: "Xoá" });
    fireEvent.click(sheetButtons[sheetButtons.length - 1]);
    await waitFor(() =>
      expect(admin.adminModerateComment).toHaveBeenCalledWith({
        commentId: 1,
        action: "delete",
      }),
    );
  });

  it("a row handled in one sub-tab stays in the others", async () => {
    // Cùng bình luận #1 nằm ở cả "Chờ duyệt" và "Bị báo cáo".
    admin.adminListComments.mockImplementation(async (f: string) => ({
      success: true,
      data:
        f === "hidden"
          ? []
          : [comment({ id: 1, status: "held", openReports: 1 })],
    }));
    admin.adminModerateComment.mockReturnValue(new Promise(() => {}));
    mount();
    fireEvent.click(screen.getByRole("tab", { name: /Bình luận/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Bị báo cáo" }));
    expect(await screen.findByText("Lan")).toBeTruthy();
  });
});

describe("admin reports tab", () => {
  it("comment report shows its excerpt and event title", () => {
    mount([
      {
        id: 9,
        targetType: "comment",
        targetName: "Buổi tối thứ 4",
        eventCode: "abc123",
        commentExcerpt: "nội dung bị báo cáo",
        reason: "spam",
        note: null,
        status: "open",
        reporterName: "Minh",
        createdAt: "2099-06-01T12:00:00.000Z",
        resolvedAt: null,
      },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Báo cáo" }));
    expect(screen.getByText("nội dung bị báo cáo")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Buổi tối thứ 4" }).getAttribute("href"),
    ).toBe("/exchanges/abc123#comments");
    expect(screen.getByText(/Bình luận:/)).toBeTruthy();
  });
});

// Task 25 carry (Tasks 23+24 review): fallback cũ chỉ có danh sách, panel hiện
// ra thì hai hàng tab chen vào và đẩy danh sách xuống.
describe("admin reputation tab fallback", () => {
  it("reserves both tab bars above the list", () => {
    render(<ReputationPanelSkeleton />);
    const bars = screen.getAllByTestId("rep-tabbar-skeleton");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.firstElementChild?.className).toContain("h-11");
    }
  });
});
