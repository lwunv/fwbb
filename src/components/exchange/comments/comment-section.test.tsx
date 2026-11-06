// @vitest-environment jsdom
/**
 * Khu bình luận trên trang buổi (g2c, Task 10). Các điều dễ hỏng im lặng:
 * 1. Khách chỉ thấy Hỏi đáp; vào ?kenh=nhom thì về Hỏi đáp, không báo lỗi.
 * 2. Body là chữ thuần: `<script>` và link không thành thẻ.
 * 3. Hữu ích dùng số server trả về, rollback khi lỗi và không bị gửi lại.
 * 4. Không polling: chỉ nút "Tải bình luận mới" mới tải lại.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import { makePage, makeView } from "./fixtures";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  replies: vi.fn(),
  add: vi.fn(),
  vote: vi.fn(),
  lock: vi.fn(),
  mark: vi.fn(),
  report: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/actions/exchange-comments", () => ({
  listExchangeComments: mocks.list,
  listCommentReplies: mocks.replies,
  addComment: mocks.add,
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  toggleCommentVote: mocks.vote,
  pinComment: vi.fn(),
  setCommentsLocked: mocks.lock,
  approveHeldComment: vi.fn(),
  markCommentsRead: mocks.mark,
}));
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

const { CommentSection } = await import("./comment-section");
const { ReportSheet } = await import("@/components/exchange/report-sheet");

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderSection(
  opts: {
    signedIn?: boolean;
    search?: string;
    eventId?: number | null;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams={opts.search ?? ""}>
          <CommentSection
            code="ABCD1234"
            signedIn={opts.signedIn ?? true}
            eventId={opts.eventId ?? null}
          />
        </NuqsTestingAdapter>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function pageFor(over: Parameters<typeof makePage>[0] = {}) {
  mocks.list.mockImplementation(async (input: { channel: string }) => ({
    success: true,
    data: makePage({ channel: input.channel as "qa" | "group", ...over }),
  }));
}

describe("CommentSection", () => {
  it("guest sees qa only and a login button instead of the composer", async () => {
    pageFor({
      role: "guest",
      canWrite: false,
      roots: [makeView({ id: 1, body: "Câu hỏi một" })],
    });
    renderSection({ signedIn: false });
    await screen.findByText("Câu hỏi một");
    expect(screen.getByRole("tab", { name: /Hỏi đáp/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Nhóm buổi/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    const login = screen.getByRole("link", { name: "Đăng nhập để bình luận" });
    expect(login.getAttribute("href")).toBe(
      `/giao-luu/dang-nhap?next=${encodeURIComponent("/giao-luu/ABCD1234")}`,
    );
  });

  it("guest opening ?kenh=nhom lands on Hỏi đáp", async () => {
    pageFor({ role: "guest", canWrite: false, roots: [makeView()] });
    renderSection({ signedIn: false, search: "?kenh=nhom" });
    await screen.findByText("Sân có điều hòa không?");
    expect(
      screen
        .getByRole("tab", { name: /Hỏi đáp/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(mocks.list.mock.calls.every((c) => c[0].channel === "qa")).toBe(
      true,
    );
    expect(screen.queryByText("Không tải được bình luận")).toBeNull();
  });

  it("approved registrant sees the group tab", async () => {
    pageFor({
      role: "approved",
      canRead: { qa: true, group: true },
      roots: [makeView()],
    });
    renderSection();
    expect(await screen.findByRole("tab", { name: /Nhóm buổi/ })).toBeTruthy();
  });

  it("body renders <script> and a link as plain text with no anchor", async () => {
    const body = "<script>alert(1)</script> https://evil.test/x";
    pageFor({ roots: [makeView({ body })] });
    const { container } = renderSection();
    const node = await screen.findByText(body);
    expect(node.className).toContain("whitespace-pre-wrap");
    expect(node.className).toContain("break-words");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });

  it("vote is optimistic, uses the server count, rolls back with a toast on error, and is not retried", async () => {
    pageFor({ roots: [makeView({ id: 5, upvotes: 2 })] });
    let resolve!: (v: unknown) => void;
    mocks.vote.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderSection();
    const btn = await screen.findByRole("button", { name: /Hữu ích/ });
    expect(btn.textContent).toContain("2");
    fireEvent.click(btn);
    expect(btn.textContent).toContain("3");
    expect(mocks.vote).toHaveBeenCalledWith({ commentId: 5, voted: true });
    await act(async () => resolve({ success: true, data: { upvotes: 7 } }));
    await waitFor(() => expect(btn.textContent).toContain("7"));

    mocks.vote.mockResolvedValueOnce({ error: "Quá nhiều lượt" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Quá nhiều lượt"),
    );
    expect(btn.textContent).toContain("7");
    expect(mocks.vote).toHaveBeenCalledTimes(2);
  });

  it("Xem thêm keeps the first page's threads and appends the next without duplicates", async () => {
    mocks.list.mockImplementation(async (input: { offset: number }) => ({
      success: true,
      data:
        input.offset === 0
          ? makePage({
              roots: [
                makeView({ id: 1, body: "bài một" }),
                makeView({ id: 2, body: "bài hai" }),
              ],
              hasMore: true,
              nextOffset: 10,
            })
          : makePage({
              roots: [
                makeView({ id: 2, body: "bài hai" }),
                makeView({ id: 3, body: "bài ba" }),
              ],
            }),
    }));
    renderSection();
    await screen.findByText("bài một");
    fireEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
    await screen.findByText("bài ba");
    expect(screen.getAllByText("bài hai")).toHaveLength(1);
    expect(screen.getByText("bài một")).toBeTruthy();
    expect(mocks.list.mock.calls[1][0].offset).toBe(10);
  });

  it("Xem 3 trả lời loads the remaining replies into the thread", async () => {
    pageFor({
      roots: [
        makeView({
          id: 1,
          moreReplies: 3,
          replies: [
            makeView({ id: 11, parentId: 1, body: "trả lời một" }),
            makeView({ id: 12, parentId: 1, body: "trả lời hai" }),
          ],
        }),
      ],
    });
    mocks.replies.mockResolvedValue({
      success: true,
      data: {
        replies: [
          makeView({ id: 13, parentId: 1, body: "trả lời ba" }),
          makeView({ id: 14, parentId: 1, body: "trả lời bốn" }),
          makeView({ id: 15, parentId: 1, body: "trả lời năm" }),
        ],
        hasMore: false,
        nextOffset: null,
      },
    });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 3 trả lời" }),
    );
    await screen.findByText("trả lời năm");
    expect(mocks.replies).toHaveBeenCalledWith({ commentId: 1, offset: 2 });
    expect(screen.getAllByText("trả lời một")).toHaveLength(1);
    expect(screen.getByText("trả lời ba")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Xem \d+ trả lời/ }),
    ).toBeNull();
  });

  it("locked shows the locked line, host still sees delete", async () => {
    pageFor({
      writeState: "locked",
      canWrite: false,
      role: "host",
      roots: [makeView({ id: 1, canDelete: true })],
    });
    renderSection({ eventId: 9 });
    await screen.findByText("Host đã khoá bình luận của buổi này.");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(screen.getByRole("menuitem", { name: "Xoá" })).toBeTruthy();
    // Công tắc khoá của host gửi đúng id buổi (đang khoá thì mở lại).
    mocks.lock.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("switch", { name: "Khoá bình luận" }));
    expect(mocks.lock).toHaveBeenCalledWith({ eventId: 9, locked: false });
  });

  it("reply to a tier-2 comment shows the @name chip, a direct reply does not", async () => {
    pageFor({
      roots: [
        makeView({
          id: 1,
          replies: [
            makeView({
              id: 11,
              parentId: 1,
              body: "tầng một",
              replies: [
                makeView({
                  id: 21,
                  parentId: 11,
                  body: "tầng hai gửi Lan",
                  replyToName: "Lan",
                }),
                makeView({
                  id: 22,
                  parentId: 11,
                  body: "tầng hai trực tiếp",
                  replyToName: null,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    renderSection();
    const withChip = (await screen.findByText("tầng hai gửi Lan")).closest(
      "article",
    )!;
    expect(within(withChip).getByText("@Lan")).toBeTruthy();
    const direct = screen.getByText("tầng hai trực tiếp").closest("article")!;
    expect(within(direct).queryByText(/^@/)).toBeNull();
    expect(screen.getAllByText(/^@/)).toHaveLength(1);
  });

  it("Tải bình luận mới refetches; no interval is set", async () => {
    pageFor({ roots: [makeView()] });
    renderSection();
    await screen.findByText("Sân có điều hòa không?");
    expect(mocks.list).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("unread triggers markCommentsRead once with newestAt", async () => {
    pageFor({
      roots: [makeView()],
      unread: true,
      newestAt: "2030-01-02T03:04:05.000Z",
    });
    mocks.mark.mockResolvedValue({ success: true });
    renderSection();
    await waitFor(() => expect(mocks.mark).toHaveBeenCalledTimes(1));
    expect(mocks.mark).toHaveBeenCalledWith({
      code: "ABCD1234",
      channel: "qa",
      upTo: "2030-01-02T03:04:05.000Z",
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.mark).toHaveBeenCalledTimes(1);
  });

  it("report sheet with commentId sends a comment target", async () => {
    mocks.report.mockResolvedValue({ success: true });
    render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <ReportSheet
          open
          onOpenChange={() => {}}
          code="ABCD1234"
          commentId={7}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("Báo cáo ai")).toBeNull();
    fireEvent.click(screen.getByTestId("turnstile"));
    fireEvent.click(await screen.findByRole("button", { name: "Gửi báo cáo" }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
    expect(mocks.report.mock.calls[0][0].target).toEqual({
      type: "comment",
      commentId: 7,
    });
  });
});
