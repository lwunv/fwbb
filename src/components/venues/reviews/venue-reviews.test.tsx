// @vitest-environment jsdom
/**
 * Khu đánh giá trên trang sân (G2d, Task 21), chỉ đọc. Các điều dễ hỏng im lặng:
 * 1. Dưới 3 đánh giá không có điểm nhưng vẫn liệt kê đánh giá.
 * 2. Chỉ có tháng, không bao giờ có ngày đầy đủ (không suy ra người viết).
 * 3. Nhận xét là chữ thuần.
 * 4. "Xem thêm" nối trang, khử trùng theo id, không polling; lỗi giữ trang đã có.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
  configure,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import type { VenueScore } from "@/lib/reputation/score";
import type {
  VenueReviewPage,
  VenueReviewView,
} from "@/lib/reputation/venue-review-read";

configure({ asyncUtilTimeout: 3000 });

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  report: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  queryOpts: [] as Record<string, unknown>[],
}));

vi.mock("@/actions/venue-reviews", () => ({ listVenueReviews: mocks.list }));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: mocks.report }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: { onToken: (t: string | null) => void }) => (
    <button
      type="button"
      data-testid="turnstile"
      onClick={() => p.onToken("tok")}
    >
      ts
    </button>
  ),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useInfiniteQuery: ((o: Record<string, unknown>) => {
      mocks.queryOpts.push(o);
      return actual.useInfiniteQuery(o as never);
    }) as unknown as typeof actual.useInfiniteQuery,
  };
});

const { VenueReviewsSection } = await import("./venue-reviews-section");
const { VenueScoreSummary } = await import("./venue-score-summary");
const { VenueReviewItem } = await import("./venue-review-item");

const CRITERIA = {
  surface: 45,
  lighting: 40,
  ventilation: 38,
  price: 42,
  parking: 50,
  owner: 41,
};

function score(over: Partial<VenueScore> = {}): VenueScore {
  return { count: 12, overall: 43, criteria: { ...CRITERIA }, ...over };
}

const NOT_ENOUGH: VenueScore = {
  count: 2,
  overall: null,
  criteria: {
    surface: null,
    lighting: null,
    ventilation: null,
    price: null,
    parking: null,
    owner: null,
  },
};

function rv(id: number, over: Partial<VenueReviewView> = {}): VenueReviewView {
  return {
    id,
    scores: {
      surface: 4,
      lighting: 5,
      ventilation: 3,
      price: 4,
      parking: 2,
      owner: 5,
    },
    comment: `Nhận xét số ${id}`,
    month: "2026-10",
    edited: false,
    ...over,
  };
}

function pageOf(ids: number[], nextOffset: number | null): VenueReviewPage {
  return {
    reviews: ids.map((id) => rv(id)),
    hasMore: nextOffset !== null,
    nextOffset,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function renderSection(
  over: Partial<{
    summary: VenueScore;
    initialPage: VenueReviewPage;
    signedIn: boolean;
  }> = {},
) {
  return wrap(
    <VenueReviewsSection
      venueId={7}
      venueName="Sân Cầu Giấy"
      signedIn={over.signedIn ?? false}
      summary={over.summary ?? score()}
      initialPage={over.initialPage ?? pageOf([1, 2, 3], null)}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryOpts.length = 0;
});
afterEach(cleanup);

describe("venue reviews section", () => {
  it("fewer than 3 reviews shows Chưa đủ đánh giá and still lists them", () => {
    renderSection({
      summary: NOT_ENOUGH,
      initialPage: pageOf([1, 2], null),
    });
    expect(screen.getByText("Chưa đủ đánh giá")).toBeTruthy();
    expect(screen.getByText("2 đánh giá")).toBeTruthy();
    expect(screen.getByText("Nhận xét số 1")).toBeTruthy();
    expect(screen.getByText("Nhận xét số 2")).toBeTruthy();
    // Không có điểm tổng hay điểm tiêu chí nào khi chưa đủ.
    expect(screen.queryByText(/^\d,\d$/)).toBeNull();
    expect(screen.getAllByText("Đã chơi ở đây")).toHaveLength(2);
  });

  it("43 renders as 4,3 in vi", () => {
    wrap(<VenueScoreSummary summary={score()} venueName="Sân Cầu Giấy" />);
    expect(screen.getByText("4,3")).toBeTruthy();
    expect(screen.getByText("12 đánh giá")).toBeTruthy();
    for (const label of [
      "Mặt sân",
      "Ánh sáng",
      "Thoáng mát",
      "Giá",
      "Gửi xe",
      "Chủ sân",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("4,5")).toBeTruthy();
    expect(screen.getByText("5,0")).toBeTruthy();
    expect(screen.queryByText("4.3")).toBeNull();
  });

  it("a review shows its month from the server, never a full date", () => {
    const { container } = wrap(
      <VenueReviewItem review={rv(5, { month: "2026-03" })} signedIn={false} />,
    );
    expect(screen.getByText("Tháng 3/2026")).toBeTruthy();
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-03");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("an edited review is labelled and shows six small scores", () => {
    wrap(<VenueReviewItem review={rv(6, { edited: true })} signedIn={false} />);
    expect(screen.getByText("đã sửa")).toBeTruthy();
    const scores = screen.getByRole("list", { name: "Điểm từng tiêu chí" });
    expect(within(scores).getAllByRole("listitem")).toHaveLength(6);
    expect(within(scores).getByText("Gửi xe").parentElement?.textContent).toBe(
      "Gửi xe2",
    );
  });

  it("a comment with <script> and a link renders as plain text", () => {
    const comment =
      '<script>alert("x")</script> xem https://evil.example và <b>đậm</b>';
    const { container } = wrap(
      <VenueReviewItem review={rv(9, { comment })} signedIn={false} />,
    );
    const body = screen.getByText(comment);
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.className).toContain("break-words");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("Xem thêm appends without duplicates and sets no refetch interval", async () => {
    const first = pageOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
    // Có đánh giá mới chen vào: trang 2 lặp lại id 10.
    mocks.list.mockResolvedValue({
      success: true,
      data: pageOf([10, 11, 12], null),
    });
    renderSection({ initialPage: first });
    expect(screen.getAllByText(/^Nhận xét số \d+$/)).toHaveLength(10);
    // Có sẵn trang đầu từ server: không tải lại lúc mở trang.
    expect(mocks.list).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
    await screen.findByText("Nhận xét số 12");
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith({ venueId: 7, offset: 10 });
    expect(screen.getAllByText("Nhận xét số 10")).toHaveLength(1);
    expect(screen.getAllByText(/^Nhận xét số \d+$/)).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Xem thêm" })).toBeNull();

    expect(mocks.queryOpts.length).toBeGreaterThan(0);
    for (const o of mocks.queryOpts) {
      expect(o.refetchInterval).toBeUndefined();
      expect(o.staleTime).toBe(60_000);
      expect(o.queryKey).toEqual(["venue-reviews", 7]);
    }
  });

  it("a page-2 error shows a toast and keeps page 1", async () => {
    mocks.list.mockResolvedValue({ error: "Lỗi máy chủ" });
    renderSection({ initialPage: pageOf([1, 2, 3], 10) });

    fireEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/^Nhận xét số \d+$/)).toHaveLength(3);
    // Bấm lại được.
    expect(screen.getByRole("button", { name: "Xem thêm" })).toBeTruthy();
  });

  it("with the app's query defaults a page-2 error fails at once after one call", async () => {
    // Đúng `defaultOptions` của `src/components/providers.tsx` (không có
    // `retry: false` như `wrap`): mặc định react-query thử lại 3 lần, khung giả
    // quay khoảng 7 giây và gọi action 4 lần trước khi báo lỗi.
    mocks.list.mockResolvedValue({ error: "Lỗi máy chủ" });
    const app = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 60 * 1000, refetchOnWindowFocus: false },
      },
    });
    render(
      <QueryClientProvider client={app}>
        <NextIntlClientProvider locale="vi" messages={viMessages}>
          <VenueReviewsSection
            venueId={7}
            venueName="Sân Cầu Giấy"
            signedIn={false}
            summary={score()}
            initialPage={pageOf([1, 2, 3], 10)}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1), {
      timeout: 800,
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("review-skeleton")).toBeNull();
    expect(screen.getAllByText(/^Nhận xét số \d+$/)).toHaveLength(3);
  });

  it("no reviews yet shows the empty line", () => {
    renderSection({
      summary: { ...NOT_ENOUGH, count: 0 },
      initialPage: pageOf([], null),
    });
    expect(screen.getByText("Chưa có đánh giá nào.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xem thêm" })).toBeNull();
  });

  it("guests see no report buttons; a signed-in viewer reports one review by id", async () => {
    renderSection();
    expect(screen.queryByRole("button", { name: /Báo cáo/ })).toBeNull();

    cleanup();
    mocks.report.mockResolvedValue({ success: true });
    renderSection({ signedIn: true });
    const items = screen.getAllByRole("article");
    expect(items).toHaveLength(3);
    const btn = within(items[1]).getByRole("button", { name: "Báo cáo" });
    expect(btn.className).toContain("min-h-11");
    fireEvent.click(btn);
    fireEvent.click(await screen.findByTestId("turnstile"));
    fireEvent.click(screen.getByRole("button", { name: "Gửi báo cáo" }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
    expect(mocks.report.mock.calls[0][0]).toMatchObject({
      target: { type: "review", reviewId: 2 },
    });
  });
});
