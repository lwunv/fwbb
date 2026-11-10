// @vitest-environment jsdom
/**
 * Viết và sửa đánh giá sân (G2d, Task 22). Các điều dễ hỏng im lặng:
 * 1. Khách không thấy nút viết, chỉ có link đăng nhập quay lại đúng sân.
 * 2. Phần riêng (đủ điều kiện, đánh giá cũ, mốc sửa) chỉ tải khi mở sheet, và
 *    sheet nói rõ vì sao không viết hay không sửa được.
 * 3. Gửi là optimistic: dòng của mình hiện ngay, lỗi thì hoàn lại với đúng chữ
 *    server, không bao giờ gửi lại cùng token Turnstile, luôn lấy token mới.
 * 4. Đánh giá bị giữ không lọt vào danh sách công khai, người viết chỉ thấy
 *    "đang chờ duyệt", không thấy lý do.
 */
import { useState } from "react";
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
import type { MyVenueReview } from "@/actions/venue-reviews";
import type { VenueScore } from "@/lib/reputation/score";
import type {
  VenueReviewPage,
  VenueReviewView,
} from "@/lib/reputation/venue-review-read";

configure({ asyncUtilTimeout: 3000 });

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  mine: vi.fn(),
  submit: vi.fn(),
  report: vi.fn(),
  refresh: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  resetKeys: [] as number[],
}));

vi.mock("@/actions/venue-reviews", () => ({
  listVenueReviews: mocks.list,
  getMyVenueReview: mocks.mine,
  submitVenueReview: mocks.submit,
}));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: mocks.report }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    action: string;
    resetKey?: number;
    onToken: (t: string | null) => void;
  }) => {
    mocks.resetKeys.push(p.resetKey ?? 0);
    return (
      <button
        type="button"
        data-testid={`turnstile-${p.action}`}
        onClick={() => p.onToken("tok")}
      >
        ts
      </button>
    );
  },
}));

const { VenueReviewsSection } = await import("./venue-reviews-section");
const { VenueReviewSheet } = await import("./venue-review-sheet");
const { StarInput } = await import("./star-input");

const SCORES = {
  surface: 4,
  lighting: 5,
  ventilation: 3,
  price: 4,
  parking: 2,
  owner: 5,
};
const LABELS = [
  "Mặt sân",
  "Ánh sáng",
  "Thoáng mát",
  "Giá",
  "Gửi xe",
  "Chủ sân",
] as const;

const SUMMARY: VenueScore = {
  count: 3,
  overall: 40,
  criteria: {
    surface: 40,
    lighting: 40,
    ventilation: 40,
    price: 40,
    parking: 40,
    owner: 40,
  },
};

function rv(id: number, over: Partial<VenueReviewView> = {}): VenueReviewView {
  return {
    id,
    scores: { ...SCORES },
    comment: `Nhận xét số ${id}`,
    month: "2026-10",
    edited: false,
    ...over,
  };
}

function pageOf(reviews: VenueReviewView[]): VenueReviewPage {
  return { reviews, hasMore: false, nextOffset: null };
}

function mine(over: Partial<MyVenueReview> = {}): {
  success: true;
  data: MyVenueReview;
} {
  return {
    success: true,
    data: { eligible: true, review: null, nextEditAt: null, ...over },
  };
}

function ownReview(
  over: Partial<NonNullable<MyVenueReview["review"]>> = {},
): NonNullable<MyVenueReview["review"]> {
  return {
    id: 11,
    scores: { ...SCORES },
    comment: "Sân cũ ổn",
    status: "visible",
    holdReason: null,
    month: "2026-10",
    editedAt: null,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let qc: QueryClient;

function wrap(ui: React.ReactNode) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function renderSection(signedIn: boolean, initial = pageOf([rv(1), rv(2)])) {
  return wrap(
    <VenueReviewsSection
      venueId={7}
      venueName="Sân Cầu Giấy"
      signedIn={signedIn}
      summary={SUMMARY}
      initialPage={initial}
    />,
  );
}

function SheetHarness({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        mở
      </button>
      <VenueReviewSheet open={open} onOpenChange={setOpen} venueId={7} />
    </>
  );
}

/** Chấm đủ 6 tiêu chí bằng cách bấm ngôi sao thứ `n` của mỗi nhóm. */
function rateAll(n: number) {
  for (const label of LABELS) {
    const group = screen.getByRole("radiogroup", { name: label });
    fireEvent.click(within(group).getByRole("radio", { name: `${n} sao` }));
  }
}

function listArticles() {
  const list = document.querySelector("[data-testid='venue-review-list']");
  return Array.from(list?.querySelectorAll("article") ?? []);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetKeys.length = 0;
  mocks.list.mockResolvedValue({ success: true, data: pageOf([rv(1), rv(2)]) });
});
afterEach(cleanup);

describe("venue review sheet", () => {
  it("a guest sees the login link with next back to the venue", () => {
    renderSection(false);
    const link = screen.getByRole("link", { name: "Đăng nhập để đánh giá" });
    expect(link.getAttribute("href")).toBe(
      `/exchanges/login?next=${encodeURIComponent("/venues/7")}`,
    );
    expect(screen.queryByRole("button", { name: "Viết đánh giá" })).toBeNull();
    expect(mocks.mine).not.toHaveBeenCalled();
  });

  it("ineligible explanation; prefilled edit; read-only until the next edit date", async () => {
    // Đóng thì không tải phần riêng.
    mocks.mine.mockResolvedValue(mine({ eligible: false }));
    const closed = wrap(<SheetHarness initialOpen={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.mine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "mở" }));
    expect(
      await screen.findByText(
        "Bạn cần được điểm danh ở một buổi tại sân này để đánh giá.",
      ),
    ).toBeTruthy();
    expect(mocks.mine).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: /Gửi đánh giá/ })).toBeNull();
    closed.unmount();

    // Đã có đánh giá, sửa được: phiếu điền sẵn điểm và nhận xét.
    mocks.mine.mockResolvedValue(mine({ review: ownReview() }));
    const edit = wrap(<SheetHarness />);
    const surface = await screen.findByRole("radiogroup", { name: "Mặt sân" });
    expect(
      within(surface)
        .getByRole("radio", { name: "4 sao" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    const parking = screen.getByRole("radiogroup", { name: "Gửi xe" });
    expect(
      within(parking)
        .getByRole("radio", { name: "2 sao" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Sân cũ ổn",
    );
    expect(screen.getByText("9/500")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Cập nhật đánh giá/ }),
    ).toBeTruthy();
    edit.unmount();

    // Vừa sửa xong: chỉ xem, ghi rõ ngày được sửa lại (giờ VN).
    mocks.mine.mockResolvedValue(
      mine({
        review: ownReview({ editedAt: "2026-11-09T18:00:00.000Z" }),
        nextEditAt: "2026-12-09T18:00:00.000Z",
      }),
    );
    wrap(<SheetHarness />);
    expect(await screen.findByText("Sửa lại được từ 10/12/2026")).toBeTruthy();
    expect(screen.getByText("Sân cũ ổn")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Cập nhật đánh giá/ }),
    ).toBeNull();
  });

  it("a hidden review explains it can no longer be edited", async () => {
    mocks.mine.mockResolvedValue(
      mine({ review: ownReview({ status: "hidden" }) }),
    );
    wrap(<SheetHarness />);
    expect(
      await screen.findByText(
        "Đánh giá của bạn đã bị ẩn sau khi kiểm duyệt nên không sửa được nữa.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("submit is optimistic, rolls back with the server message, never retries, resets Turnstile", async () => {
    mocks.mine.mockResolvedValue(mine());
    const reply = deferred<{ error: string }>();
    mocks.submit.mockReturnValue(reply.promise);
    renderSection(true);
    expect(listArticles()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Viết đánh giá" }));
    await screen.findByRole("radiogroup", { name: "Mặt sân" });

    // Thiếu tiêu chí thì không gửi.
    fireEvent.click(screen.getByTestId("turnstile-venue_review"));
    fireEvent.click(screen.getByRole("button", { name: /Gửi đánh giá/ }));
    expect(await screen.findAllByText(/Chọn số sao cho/)).not.toHaveLength(0);
    expect(mocks.submit).not.toHaveBeenCalled();

    rateAll(5);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  Sân mới sơn, ánh sáng tốt  " },
    });
    const keysBefore = Math.max(...mocks.resetKeys);
    fireEvent.click(screen.getByRole("button", { name: /Gửi đánh giá/ }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));

    const input = mocks.submit.mock.calls[0][0];
    expect(input).toMatchObject({
      venueId: 7,
      scores: {
        surface: 5,
        lighting: 5,
        ventilation: 5,
        price: 5,
        parking: 5,
        owner: 5,
      },
      comment: "Sân mới sơn, ánh sáng tốt",
      turnstileToken: "tok",
    });
    expect(input.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Dòng của mình hiện ngay đầu danh sách, nhãn "Đang gửi…".
    await waitFor(() => expect(listArticles()).toHaveLength(3));
    const first = listArticles()[0];
    expect(first.textContent).toContain("Đang gửi…");
    expect(first.textContent).toContain("Sân mới sơn, ánh sáng tốt");

    reply.resolve({ error: "Bạn gửi nhanh quá, thử lại sau nhé." });
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Bạn gửi nhanh quá, thử lại sau nhé.",
      ),
    );
    await waitFor(() => expect(listArticles()).toHaveLength(2));
    expect(screen.queryByText("Đang gửi…")).toBeNull();
    // Mở lại phiếu, giữ nguyên chữ đã gõ, token mới.
    expect(
      ((await screen.findByRole("textbox")) as HTMLTextAreaElement).value,
    ).toBe("  Sân mới sơn, ánh sáng tốt  ");
    expect(Math.max(...mocks.resetKeys)).toBeGreaterThan(keysBefore);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    // Token đã dùng thì không được gửi lại: phải chờ token mới.
    expect(
      screen
        .queryByRole("button", { name: /Gửi đánh giá/ })
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("editing replaces the row with the same id", async () => {
    mocks.mine.mockResolvedValue(
      mine({ review: ownReview({ id: 2, comment: "Nhận xét số 2" }) }),
    );
    const reply = deferred<{
      success: true;
      data: { id: number; status: "visible" };
    }>();
    mocks.submit.mockReturnValue(reply.promise);
    renderSection(true);

    fireEvent.click(screen.getByRole("button", { name: "Viết đánh giá" }));
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Đã sửa: sân sạch hơn" } });
    fireEvent.click(screen.getByTestId("turnstile-venue_review"));
    fireEvent.click(screen.getByRole("button", { name: /Cập nhật đánh giá/ }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByText("Đã sửa: sân sạch hơn")).toBeTruthy(),
    );
    const rows = listArticles();
    expect(rows).toHaveLength(2);
    expect(screen.queryByText("Nhận xét số 2")).toBeNull();
    // Thay đúng chỗ của dòng id 2 (thứ hai), không chèn thêm lên đầu.
    expect(rows[1].textContent).toContain("Đang gửi…");
    expect(rows[0].textContent).toContain("Nhận xét số 1");

    const spy = vi.spyOn(qc, "invalidateQueries");
    mocks.list.mockResolvedValue({
      success: true,
      data: pageOf([
        rv(1),
        rv(2, { comment: "Đã sửa: sân sạch hơn", edited: true }),
      ]),
    });
    reply.resolve({ success: true, data: { id: 2, status: "visible" } });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["venue-reviews", 7]);
    expect(keys).toContainEqual(["my-venue-review", 7]);
    expect(mocks.toast.success).toHaveBeenCalledWith("Đã gửi đánh giá");
    await waitFor(() => expect(screen.queryByText("Đang gửi…")).toBeNull());
    expect(listArticles()).toHaveLength(2);
  });

  it("a held result shows the waiting toast and the own review only in the sheet", async () => {
    mocks.mine.mockResolvedValueOnce(mine());
    mocks.submit.mockResolvedValue({
      success: true,
      data: { id: 99, status: "held" },
    });
    renderSection(true);

    fireEvent.click(screen.getByRole("button", { name: "Viết đánh giá" }));
    await screen.findByRole("radiogroup", { name: "Mặt sân" });
    rateAll(3);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Liên hệ chủ sân giữ chỗ" },
    });
    mocks.mine.mockResolvedValue(
      mine({
        review: ownReview({
          id: 99,
          scores: {
            surface: 3,
            lighting: 3,
            ventilation: 3,
            price: 3,
            parking: 3,
            owner: 3,
          },
          comment: "Liên hệ chủ sân giữ chỗ",
          status: "held",
          holdReason: "contact",
        }),
      }),
    );
    fireEvent.click(screen.getByTestId("turnstile-venue_review"));
    fireEvent.click(screen.getByRole("button", { name: /Gửi đánh giá/ }));

    await waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "Đánh giá của bạn đang chờ duyệt",
      ),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    // Không vào danh sách công khai.
    await waitFor(() => expect(listArticles()).toHaveLength(2));
    expect(
      listArticles().some((a) =>
        a.textContent?.includes("Liên hệ chủ sân giữ chỗ"),
      ),
    ).toBe(false);
    // Trong sheet: nhãn chờ duyệt, không lộ lý do giữ.
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Đang chờ duyệt")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/contact|liên lạc|số điện thoại/i);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("star input: each star at least 44px, arrow keys move, aria-checked follows", () => {
    function Harness() {
      const [v, setV] = useState(0);
      return <StarInput label="Mặt sân" value={v} onChange={setV} />;
    }
    wrap(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Mặt sân" });
    const stars = within(group).getAllByRole("radio");
    expect(stars).toHaveLength(5);
    for (const s of stars) {
      expect(s.className).toMatch(/\bsize-11\b|\bmin-h-11\b.*\bmin-w-11\b/);
    }
    // Chưa chọn: chỉ ngôi đầu nhận Tab, không ngôi nào được chọn.
    expect(stars.map((s) => s.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(stars[0].getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(stars[0], { key: "ArrowRight" });
    expect(stars[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(stars[0], { key: "ArrowRight" });
    fireEvent.keyDown(stars[1], { key: "ArrowRight" });
    expect(stars[2].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(stars[2]);
    expect(stars[2].getAttribute("tabindex")).toBe("0");
    expect(stars[0].getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(stars[2], { key: "ArrowLeft" });
    expect(stars[1].getAttribute("aria-checked")).toBe("true");
    expect(stars[2].getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(stars[1], { key: "End" });
    expect(stars[4].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(stars[4], { key: "ArrowRight" });
    expect(stars[4].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(stars[4], { key: "Home" });
    expect(stars[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(stars[3]);
    expect(stars[3].getAttribute("aria-checked")).toBe("true");
  });
});
