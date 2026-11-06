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
  configure,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import enMessages from "@/i18n/messages/en.json";
import { makePage, makeView } from "./fixtures";

configure({ asyncUtilTimeout: 3000 });

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  replies: vi.fn(),
  add: vi.fn(),
  vote: vi.fn(),
  edit: vi.fn(),
  del: vi.fn(),
  lock: vi.fn(),
  mark: vi.fn(),
  report: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/actions/exchange-comments", () => ({
  listExchangeComments: mocks.list,
  listCommentReplies: mocks.replies,
  addComment: mocks.add,
  editComment: mocks.edit,
  deleteComment: mocks.del,
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
    locale?: "vi" | "en";
    /** Giữ nguyên retry mặc định của react-query (app thật không tắt retry). */
    defaultRetry?: boolean;
    /** URL cập nhật thật (nuqs testing adapter), cần khi kênh phải đổi theo URL. */
    memory?: boolean;
    onUrlUpdate?: (u: { searchParams: URLSearchParams }) => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: opts.defaultRetry ? { gcTime: 0 } : { retry: false, gcTime: 0 },
    },
  });
  const en = opts.locale === "en";
  return render(
    <NextIntlClientProvider
      locale={en ? "en" : "vi"}
      messages={en ? enMessages : viMessages}
    >
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter
          searchParams={opts.search ?? ""}
          hasMemory={opts.memory}
          onUrlUpdate={opts.onUrlUpdate}
        >
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
    expect(await screen.findByRole("menuitem", { name: "Xoá" })).toBeTruthy();
    // Danh sách thao tác là hộp thoại modal: đóng nó trước khi chạm công tắc phía sau.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
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
    // Giả lập thời gian TRƯỚC khi render để bắt cả `refetchInterval`.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pageFor({ roots: [makeView()] });
    renderSection();
    await screen.findByText("Sân có điều hòa không?");
    expect(mocks.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mocks.list).toHaveBeenCalledTimes(1);

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

  it("deleting a loaded reply keeps it gone after the refetch, and a new reply after full expansion is reachable", async () => {
    const reply = (id: number) =>
      makeView({
        id,
        parentId: 1,
        body: `trả lời ${id}`,
        canDelete: true,
      });
    let phase: "before" | "afterDelete" | "afterNew" = "before";
    mocks.list.mockImplementation(async () => ({
      success: true,
      data: makePage({
        roots: [
          makeView({
            id: 1,
            moreReplies: phase === "afterDelete" ? 2 : 3,
            replies: [reply(11), reply(12)],
          }),
        ],
      }),
    }));
    mocks.replies.mockImplementation(async () => ({
      success: true,
      data: {
        replies:
          phase === "before"
            ? [reply(13), reply(14), reply(15)]
            : phase === "afterDelete"
              ? [reply(14), reply(15)]
              : [reply(14), reply(15), reply(16)],
        hasMore: false,
        nextOffset: null,
      },
    }));
    mocks.del.mockResolvedValue({ success: true });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 3 trả lời" }),
    );
    await screen.findByText("trả lời 13");

    // Xoá một trả lời đã tải thêm (13).
    const row = screen.getByText("trả lời 13").closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "Thêm" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Xoá" }));
    phase = "afterDelete";
    fireEvent.click(await screen.findByRole("button", { name: "Xoá" }));
    await waitFor(() =>
      expect(mocks.del).toHaveBeenCalledWith({ commentId: 13 }),
    );
    await waitFor(() =>
      expect(mocks.list.mock.calls.length).toBeGreaterThan(1),
    );
    await waitFor(() => expect(screen.queryByText("[đã xoá]")).toBeNull());
    expect(screen.getByText("trả lời 14")).toBeTruthy();
    expect(screen.queryByText("trả lời 13")).toBeNull();

    // Có trả lời mới sau khi đã mở hết: tải lại thì thấy ngay.
    phase = "afterNew";
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await screen.findByText("trả lời 16");
    expect(screen.queryByText("trả lời 13")).toBeNull();
  });

  it("a new reply after full expansion appears once the open thread is reloaded", async () => {
    let extra = 0;
    mocks.list.mockImplementation(async () => ({
      success: true,
      data: makePage({
        roots: [
          makeView({
            id: 1,
            moreReplies: 1 + extra,
            replies: [makeView({ id: 11, parentId: 1, body: "đầu tiên" })],
          }),
        ],
      }),
    }));
    mocks.replies.mockImplementation(async () => ({
      success: true,
      data: {
        replies: [makeView({ id: 12, parentId: 1, body: "thứ hai" })],
        hasMore: false,
        nextOffset: null,
      },
    }));
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 1 trả lời" }),
    );
    await screen.findByText("thứ hai");
    expect(
      screen.queryByRole("button", { name: /Xem \d+ trả lời/ }),
    ).toBeNull();
    // Server báo thêm một trả lời; danh sách mở rộng giữ nguyên vì được tải lại.
    extra = 1;
    mocks.replies.mockImplementation(async () => ({
      success: true,
      data: {
        replies: [
          makeView({ id: 12, parentId: 1, body: "thứ hai" }),
          makeView({ id: 13, parentId: 1, body: "thứ ba mới" }),
        ],
        hasMore: false,
        nextOffset: null,
      },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await screen.findByText("thứ ba mới");
    expect(screen.getByText("thứ hai")).toBeTruthy();
  });

  it("an expanded second-level thread survives a refetch", async () => {
    const t2 = (id: number) =>
      makeView({ id, parentId: 12, body: `tầng hai ${id}` });
    mocks.list.mockImplementation(async () => ({
      success: true,
      data: makePage({
        roots: [makeView({ id: 1, moreReplies: 1, replies: [] })],
      }),
    }));
    mocks.replies.mockImplementation(async (input: { commentId: number }) => ({
      success: true,
      data: {
        replies:
          input.commentId === 1
            ? [
                makeView({
                  id: 12,
                  parentId: 1,
                  body: "tầng một",
                  moreReplies: 3,
                }),
              ]
            : [t2(21), t2(22), t2(23)],
        hasMore: false,
        nextOffset: null,
      },
    }));
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 1 trả lời" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 3 trả lời" }),
    );
    await screen.findByText("tầng hai 23");

    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    // Lần tải lại gọi trả lời cho cả hai neo (gốc, rồi tầng một vừa tải về).
    await waitFor(() => expect(mocks.replies).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText("tầng hai 23")).toBeTruthy());
    expect(screen.getAllByText("tầng hai 21")).toHaveLength(1);
    expect(screen.getByText("tầng một")).toBeTruthy();
  });

  it("a partial reload keeps the real next offset for the next Xem N click", async () => {
    mocks.list.mockImplementation(async () => ({
      success: true,
      data: makePage({
        roots: [makeView({ id: 1, moreReplies: 7, replies: [] })],
      }),
    }));
    // Server bước 10 mỗi trang, trả 1 trả lời mỗi lần: offset kế tiếp KHÁC số đã tải.
    mocks.replies.mockImplementation(async (input: { offset: number }) => ({
      success: true,
      data: {
        replies: [
          makeView({
            id: 100 + input.offset,
            parentId: 1,
            body: `r${input.offset}`,
          }),
        ],
        hasMore: input.offset < 60,
        nextOffset: input.offset + 10,
      },
    }));
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 7 trả lời" }),
    );
    await screen.findByText("r0");
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    // Tải lại dừng ở trần 5 trang (offset 0..40), còn lại 2.
    const more = await screen.findByRole("button", { name: "Xem 2 trả lời" });
    expect(screen.getByText("r40")).toBeTruthy();
    mocks.replies.mockClear();
    fireEvent.click(more);
    await waitFor(() => expect(mocks.replies).toHaveBeenCalled());
    expect(mocks.replies).toHaveBeenCalledWith({ commentId: 1, offset: 50 });
  });

  it("a refetch keeps the vote patch while the vote is still in flight", async () => {
    pageFor({ roots: [makeView({ id: 5, upvotes: 2 })] });
    let resolve!: (v: unknown) => void;
    mocks.vote.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderSection();
    const btn = await screen.findByRole("button", { name: /Hữu ích/ });
    fireEvent.click(btn);
    expect(btn.textContent).toContain("3");
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(btn.textContent).toContain("3");
    await act(async () => resolve({ success: true, data: { upvotes: 3 } }));
    expect(btn.textContent).toContain("3");
  });

  it("a thread opened while another reload is in flight is not lost", async () => {
    pageFor({
      roots: [
        makeView({ id: 1, body: "gốc A", moreReplies: 1, replies: [] }),
        makeView({ id: 2, body: "gốc B", moreReplies: 1, replies: [] }),
      ],
    });
    let aCalls = 0;
    let releaseA!: () => void;
    mocks.replies.mockImplementation(async (input: { commentId: number }) => {
      if (input.commentId === 1 && ++aCalls > 1) {
        await new Promise<void>((r) => (releaseA = r));
      }
      return {
        success: true,
        data: {
          replies: [
            makeView({
              id: 50 + input.commentId,
              parentId: input.commentId,
              body: `con của ${input.commentId}`,
            }),
          ],
          hasMore: false,
          nextOffset: null,
        },
      };
    });
    renderSection();
    const open = await screen.findAllByRole("button", {
      name: "Xem 1 trả lời",
    });
    fireEvent.click(open[0]);
    await screen.findByText("con của 1");
    // Tải lại: chủ đề A bị treo giữa chừng, người dùng mở tiếp chủ đề B.
    fireEvent.click(screen.getByRole("button", { name: "Tải bình luận mới" }));
    await waitFor(() => expect(releaseA).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Xem 1 trả lời" }));
    await screen.findByText("con của 2");
    await act(async () => releaseA());
    await waitFor(() => expect(screen.getByText("con của 1")).toBeTruthy());
    expect(screen.getByText("con của 2")).toBeTruthy();
  });

  it("denied group channel falls back to Hỏi đáp at once, without react-query retries", async () => {
    mocks.list.mockImplementation(async (input: { channel: string }) =>
      input.channel === "group"
        ? { error: "Không tìm thấy bình luận" }
        : { success: true, data: makePage({ roots: [makeView()] }) },
    );
    const urls: string[] = [];
    renderSection({
      search: "?kenh=nhom",
      defaultRetry: true,
      memory: true,
      onUrlUpdate: (u) => urls.push(u.searchParams.toString()),
    });
    await screen.findByText("Sân có điều hòa không?");
    const groupCalls = mocks.list.mock.calls.filter(
      (c) => c[0].channel === "group",
    );
    expect(groupCalls).toHaveLength(1);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(urls.at(-1)).not.toContain("kenh=nhom");
  });

  it("guest opening ?kenh=nhom also corrects the URL back to qa", async () => {
    pageFor({ role: "guest", canWrite: false, roots: [makeView()] });
    const urls: string[] = [];
    renderSection({
      signedIn: false,
      search: "?kenh=nhom",
      onUrlUpdate: (u) => urls.push(u.searchParams.toString()),
    });
    await screen.findByText("Sân có điều hòa không?");
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(urls.at(-1)).not.toContain("kenh=nhom");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("a locked account (page role guest) gets the login line and no vote or report", async () => {
    pageFor({ role: "guest", canWrite: false, roots: [makeView()] });
    renderSection({ signedIn: true });
    await screen.findByText("Sân có điều hòa không?");
    expect(
      screen.getByRole("link", { name: "Đăng nhập để bình luận" }),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /Hữu ích/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Thêm" })).toBeNull();
  });

  it("edit is optimistic and rolls back with a toast on error", async () => {
    pageFor({
      roots: [makeView({ id: 8, body: "bản cũ", mine: true, canEdit: true })],
    });
    let reject!: (v: unknown) => void;
    mocks.edit.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    renderSection();
    await screen.findByText("bản cũ");
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sửa" }));
    // Ô viết gốc nay nằm đầu danh sách (không còn dính đáy), nên chọn ô sửa theo nội dung.
    fireEvent.change(screen.getByDisplayValue("bản cũ"), {
      target: { value: "bản mới" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(screen.getByText("bản mới")).toBeTruthy();
    expect(screen.getByText("đã sửa")).toBeTruthy();
    expect(mocks.edit).toHaveBeenCalledWith({ commentId: 8, body: "bản mới" });
    await act(async () => reject(new Error("hết hạn sửa")));
    await waitFor(() => expect(screen.getByText("bản cũ")).toBeTruthy());
    expect(screen.queryByText("đã sửa")).toBeNull();
    expect(mocks.toast.error).toHaveBeenCalledWith("hết hạn sửa");
  });

  it("a failing reply load shows a toast instead of an unhandled rejection", async () => {
    pageFor({ roots: [makeView({ id: 1, moreReplies: 2, replies: [] })] });
    mocks.replies.mockRejectedValue(new Error("mạng lỗi"));
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 2 trả lời" }),
    );
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("mạng lỗi"),
    );
  });

  it("en uses a plural for the reply count", async () => {
    pageFor({ roots: [makeView({ id: 1, moreReplies: 1, replies: [] })] });
    renderSection({ locale: "en" });
    expect(
      await screen.findByRole("button", { name: "View 1 reply" }),
    ).toBeTruthy();
  });

  it("sending shows a temporary row at once and removes it with the text kept on error", async () => {
    pageFor({ roots: [makeView({ id: 1, body: "Câu hỏi một" })] });
    let failSend: (v: unknown) => void = () => {};
    mocks.add.mockReturnValue(new Promise((r) => (failSend = r)));
    renderSection({ search: "?bl=new" });
    await screen.findByText("Câu hỏi một");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Gửi thử nè" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    // Dòng tạm hiện ngay trong danh sách (không đợi server), có nhãn đang gửi.
    const temp = (await screen.findAllByText("Gửi thử nè")).find((el) =>
      el.closest("article"),
    );
    expect(temp).toBeTruthy();
    expect(
      within(temp!.closest("article")!).getByText("Đang gửi…"),
    ).toBeTruthy();
    await act(async () => failSend({ error: "Bạn gửi quá nhanh" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Bạn gửi quá nhanh"),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByText("Gửi thử nè")
          .filter((el) => el.closest("article")),
      ).toHaveLength(0),
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Gửi thử nè",
    );
  });

  it("a failing reply load toasts exactly once", async () => {
    pageFor({ roots: [makeView({ id: 1, moreReplies: 2, replies: [] })] });
    mocks.replies.mockResolvedValue({ error: "máy chủ bận" });
    renderSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xem 2 trả lời" }),
    );
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith("máy chủ bận");
  });

  it("the action list opens in a dialog outside the thread card and still works", async () => {
    pageFor({
      roots: [makeView({ id: 1, canDelete: true }), makeView({ id: 2 })],
    });
    renderSection();
    const trigger = (await screen.findAllByRole("button", { name: "Thêm" }))[0];
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    // Không nằm trong thẻ chủ đề (thẻ có backdrop-blur giam z-index của dropdown).
    expect(menu.closest("[data-thread]")).toBeNull();
    expect(screen.getByRole("dialog").contains(menu)).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Xoá" }));
    expect(await screen.findByText("Xoá bình luận này?")).toBeTruthy();
  });

  it("Escape closes the action list and returns focus to its trigger", async () => {
    pageFor({ roots: [makeView({ id: 1, canDelete: true })] });
    renderSection();
    const trigger = await screen.findByRole("button", { name: "Thêm" });
    fireEvent.click(trigger);
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("the temporary row is replaced by the real one with no gap and no duplicate", async () => {
    const real = makeView({ id: 50, body: "Chốt nhé", mine: true });
    let sent = false;
    mocks.list.mockImplementation(async () => ({
      success: true,
      data: makePage({
        roots: sent
          ? [real, makeView({ id: 1, body: "Câu hỏi một" })]
          : [makeView({ id: 1, body: "Câu hỏi một" })],
      }),
    }));
    mocks.add.mockImplementation(async () => {
      sent = true;
      return { success: true, data: { id: 50, status: "visible" } };
    });
    const { container } = renderSection({ search: "?bl=new" });
    await screen.findByText("Câu hỏi một");
    const count = () =>
      screen.queryAllByText("Chốt nhé").filter((el) => el.closest("article"))
        .length;
    const seen: number[] = [];
    const obs = new MutationObserver(() => seen.push(count()));
    obs.observe(container, { childList: true, subtree: true });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Chốt nhé" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await waitFor(() =>
      expect(mocks.list.mock.calls.length).toBeGreaterThan(1),
    );
    await waitFor(() => expect(screen.queryByText("Đang gửi…")).toBeNull());
    obs.disconnect();
    expect(count()).toBe(1);
    // Từ lúc dòng tạm hiện, không khung nào có 0 hoặc 2 bản.
    const afterFirst = seen.slice(seen.indexOf(1));
    expect(afterFirst).toEqual(afterFirst.map(() => 1));
  });

  it("a pending send is not shown in the other channel", async () => {
    pageFor({
      canRead: { qa: true, group: true },
      roots: [makeView({ id: 1, body: "Câu hỏi một" })],
    });
    mocks.add.mockReturnValue(new Promise(() => {}));
    renderSection({ memory: true });
    await screen.findByText("Câu hỏi một");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Chỉ ở hỏi đáp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await screen.findAllByText("Đang gửi…");
    fireEvent.click(await screen.findByRole("tab", { name: /Nhóm buổi/ }));
    await waitFor(() =>
      expect(
        screen
          .queryAllByText("Chỉ ở hỏi đáp")
          .filter((el) => el.closest("article")),
      ).toHaveLength(0),
    );
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
