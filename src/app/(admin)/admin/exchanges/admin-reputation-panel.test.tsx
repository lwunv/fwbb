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
const rep = vi.hoisted(() => ({
  adminListVenueReviews: vi.fn(),
  adminModerateVenueReview: vi.fn(),
  adminListHostFlags: vi.fn(),
  adminReviewHostFlag: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/actions/exchange-admin", () => admin);
vi.mock("@/actions/reputation-admin", () => rep);
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const { AdminExchangeClient } = await import("./admin-exchange-client");
const { default: AdminExchangePage } = await import("./page");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const review = (over: Record<string, unknown>) => ({
  id: 1,
  venueId: 7,
  venueName: "Sân Cầu Giấy",
  authorName: "Lan",
  scores: {
    surface: 4,
    lighting: 5,
    ventilation: 3,
    price: 4,
    parking: 2,
    owner: 5,
  },
  comment: "Sân đẹp, <b>đèn sáng</b>",
  status: "held",
  holdReason: "contact",
  reportCount: 0,
  openReports: 0,
  createdAt: "2099-06-01T12:00:00.000Z",
  updatedAt: "2099-06-01T12:00:00.000Z",
  ...over,
});

function mount(
  initialTab?: "events" | "reports" | "comments" | "reputation",
  reports: unknown[] = [],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <AdminExchangeClient
          initialEvents={[]}
          initialReports={reports as never}
          initialTab={initialTab}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function reviewsBy(list: Record<string, unknown[]>) {
  rep.adminListVenueReviews.mockImplementation(async (f: string) => ({
    success: true,
    data: list[f] ?? [],
  }));
}

describe("admin reputation tab", () => {
  it("?tab=reputation opens the tab", async () => {
    admin.adminListExchanges.mockResolvedValue({ success: true, data: [] });
    admin.adminListReports.mockResolvedValue({ success: true, data: [] });
    const el = await AdminExchangePage({
      searchParams: Promise.resolve({ tab: "reputation" }),
    });
    expect(el.props.initialTab).toBe("reputation");
    const other = await AdminExchangePage({
      searchParams: Promise.resolve({ tab: "nope" }),
    });
    expect(other.props.initialTab).toBe("events");

    reviewsBy({ held: [review({})] });
    mount("reputation");
    expect(
      screen.getByRole("tab", { name: /Uy tín/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(await screen.findByText("Sân Cầu Giấy")).toBeTruthy();
    expect(rep.adminListVenueReviews).toHaveBeenCalledWith("held");
    // Cờ host chỉ tải khi mở tab con của nó (quota Turso).
    expect(rep.adminListHostFlags).not.toHaveBeenCalled();
  });

  it("review moderation approves optimistically and rolls back on error", async () => {
    let resolveMod: (v: unknown) => void = () => {};
    rep.adminModerateVenueReview.mockReturnValueOnce(
      new Promise((r) => (resolveMod = r)),
    );
    reviewsBy({
      held: [
        review({ id: 1 }),
        review({ id: 2, venueName: "Sân Mỹ Đình", authorName: "Hoa" }),
      ],
    });
    mount("reputation");

    // Thẻ: tên sân, người viết, điểm, nhận xét chữ thuần, lý do giữ.
    expect(await screen.findByText("Sân Cầu Giấy")).toBeTruthy();
    expect(screen.getByText("Lan")).toBeTruthy();
    expect(screen.getAllByText("Mặt sân").length).toBe(2);
    expect(screen.getAllByText("Sân đẹp, <b>đèn sáng</b>").length).toBe(2);
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getAllByText(/Có số điện thoại hoặc liên kết/).length).toBe(
      2,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Duyệt" })[0]);
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
    expect(rep.adminModerateVenueReview).toHaveBeenCalledWith({
      reviewId: 1,
      action: "approve",
    });
    resolveMod({ success: true });

    rep.adminModerateVenueReview.mockResolvedValueOnce({ error: "nope" });
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"));
    expect(await screen.findByText("Hoa")).toBeTruthy();
    // retry: false: lần duyệt thứ hai chỉ gọi đúng một lần.
    expect(rep.adminModerateVenueReview).toHaveBeenCalledTimes(2);
  });

  it("anomaly holds show the full comment text", async () => {
    const long = `Gọi 0912 345 678 hoặc zalo.me/x để đặt sân. ${"rất tốt ".repeat(40)}cuối`;
    reviewsBy({ held: [review({ holdReason: "anomaly", comment: long })] });
    mount("reputation");
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === "P" && el.textContent === long,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Điểm lệch nhiều/)).toBeTruthy();
  });

  it("hide asks for confirmation", async () => {
    reviewsBy({ held: [review({ id: 5 })] });
    rep.adminModerateVenueReview.mockResolvedValue({ success: true });
    mount("reputation");
    fireEvent.click(await screen.findByRole("button", { name: "Ẩn" }));
    expect(
      await screen.findByText(/không còn hiện trên trang sân/),
    ).toBeTruthy();
    expect(rep.adminModerateVenueReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ẩn đánh giá" }));
    await waitFor(() =>
      expect(rep.adminModerateVenueReview).toHaveBeenCalledWith({
        reviewId: 5,
        action: "hide",
      }),
    );
  });

  it("a patch in one filter does not leak into another", async () => {
    // Cùng đánh giá #1 nằm ở "Chờ duyệt" và "Bị báo cáo".
    reviewsBy({
      held: [review({ id: 1, openReports: 1 })],
      reported: [review({ id: 1, openReports: 1 })],
    });
    rep.adminModerateVenueReview.mockReturnValue(new Promise(() => {}));
    mount("reputation");
    fireEvent.click(await screen.findByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(screen.queryByText("Lan")).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: "Bị báo cáo" }));
    expect(await screen.findByText("Lan")).toBeTruthy();
    expect(screen.getByText("1 báo cáo")).toBeTruthy();
    expect(rep.adminListVenueReviews).toHaveBeenCalledWith("reported");
  });

  it("host flags show captive counts, the truncated line, and Đã xem removes the row", async () => {
    reviewsBy({});
    rep.adminListHostFlags.mockResolvedValue({
      success: true,
      data: {
        truncated: true,
        rows: [
          {
            hostMemberId: 11,
            hostName: "Tuấn",
            hostCode: "abcdefghij",
            captives: 4,
            events: 6,
            reviewedCaptives: null,
          },
          {
            hostMemberId: 12,
            hostName: "Minh",
            hostCode: null,
            captives: 3,
            events: 3,
            reviewedCaptives: 2,
          },
        ],
      },
    });
    let resolveSeen: (v: unknown) => void = () => {};
    rep.adminReviewHostFlag.mockReturnValueOnce(
      new Promise((r) => (resolveSeen = r)),
    );
    mount("reputation");
    fireEvent.click(screen.getByRole("tab", { name: "Cờ host" }));

    expect(await screen.findByText("Tuấn")).toBeTruthy();
    expect(
      screen.getByText("Danh sách có thể thiếu vì quá nhiều dữ liệu"),
    ).toBeTruthy();
    expect(screen.getByText(/4 người chỉ đi buổi của host này/)).toBeTruthy();
    expect(screen.getByText(/6 buổi/)).toBeTruthy();
    expect(screen.getByText(/Lần xem trước: 2 người/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Tuấn" }).getAttribute("href"),
    ).toBe("/players/abcdefghij");

    fireEvent.click(screen.getAllByRole("button", { name: "Đã xem" })[0]);
    await waitFor(() => expect(screen.queryByText("Tuấn")).toBeNull());
    // Server tự đếm lại: client chỉ gửi id host.
    expect(rep.adminReviewHostFlag).toHaveBeenCalledWith({ hostMemberId: 11 });
    resolveSeen({ success: true, data: { captives: 4 } });

    rep.adminReviewHostFlag.mockResolvedValue({ error: "nope" });
    fireEvent.click(screen.getByRole("button", { name: "Đã xem" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"));
    expect(await screen.findByText("Minh")).toBeTruthy();
  });

  it("a review report card shows venue name, excerpt and links", async () => {
    reviewsBy({ reported: [review({ id: 3, status: "visible" })] });
    mount("reports", [
      {
        id: 9,
        targetType: "review",
        targetName: "Sân Cầu Giấy",
        eventCode: null,
        commentExcerpt: null,
        venueId: 7,
        reviewExcerpt: "Chủ sân thái độ",
        reason: "spam",
        note: null,
        status: "open",
        reporterName: "Minh",
        createdAt: "2099-06-01T12:00:00.000Z",
        resolvedAt: null,
      },
      {
        id: 10,
        targetType: "venue",
        targetName: "Sân Mỹ Đình",
        eventCode: null,
        commentExcerpt: null,
        venueId: 8,
        reviewExcerpt: null,
        reason: "other",
        note: null,
        status: "open",
        reporterName: "Hoa",
        createdAt: "2099-06-01T12:00:00.000Z",
        resolvedAt: null,
      },
    ]);
    expect(screen.getByText("Chủ sân thái độ")).toBeTruthy();
    expect(screen.getByText(/Đánh giá sân:/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sân Cầu Giấy" }).getAttribute("href"),
    ).toBe("/venues/7");
    expect(
      screen.getByRole("link", { name: "Sân Mỹ Đình" }).getAttribute("href"),
    ).toBe("/venues/8");
    // Chỉ báo cáo đánh giá có lối sang tab Uy tín.
    const toRep = screen.getAllByRole("link", { name: "Xem ở tab Uy tín" });
    expect(toRep).toHaveLength(1);
    expect(toRep[0].getAttribute("href")).toBe(
      "/admin/exchanges?tab=reputation",
    );

    fireEvent.click(toRep[0]);
    expect(await screen.findByText("Lan")).toBeTruthy();
    expect(rep.adminListVenueReviews).toHaveBeenCalledWith("reported");
  });
});
