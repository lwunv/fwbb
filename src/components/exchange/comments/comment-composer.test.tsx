// @vitest-environment jsdom
/**
 * Ô viết bình luận (g2c, Task 10). Các điều dễ hỏng im lặng:
 * 1. Token Turnstile dùng một lần: gửi lại sau token phải giữ NGUYÊN idempotencyKey.
 * 2. Lỗi server giữ nguyên chữ người dùng đã gõ và hiện đúng thông báo server.
 * 3. Kết quả `held` phải nói rõ bình luận đang chờ host duyệt.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  configure,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

// Dưới tải song song, 1s mặc định của waitFor không đủ (từng flake).
configure({ asyncUtilTimeout: 3000 });

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  editComment: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  resetKeys: [] as number[],
}));

vi.mock("@/actions/exchange-comments", () => ({
  addComment: mocks.addComment,
  editComment: mocks.editComment,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    onToken: (t: string | null) => void;
    resetKey: number;
  }) => {
    mocks.resetKeys.push(p.resetKey);
    return (
      <button
        type="button"
        data-testid="turnstile"
        onClick={() => p.onToken("tok1")}
      >
        ts
      </button>
    );
  },
}));

const { CommentComposer } = await import("./comment-composer");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resetKeys.length = 0;
});
afterEach(cleanup);

function renderComposer(
  props: Partial<Parameters<typeof CommentComposer>[0]> = {},
) {
  const onSent = vi.fn();
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <CommentComposer
        code="ABCD1234"
        channel="qa"
        needsCaptcha={false}
        onSent={onSent}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSent };
}

function type(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
}

describe("CommentComposer", () => {
  it("shows the character counter", () => {
    renderComposer();
    type("xin chào");
    expect(screen.getByText("8/1000")).toBeTruthy();
  });

  it("first send shows Turnstile, token resends with the same idempotencyKey", async () => {
    mocks.addComment
      .mockResolvedValueOnce({ needsCaptcha: true })
      .mockResolvedValueOnce({
        success: true,
        data: { id: 3, status: "visible" },
      });
    const { onSent } = renderComposer();
    expect(screen.queryByTestId("turnstile")).toBeNull();
    type("Có chỗ gửi xe không?");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));

    await waitFor(() => expect(screen.getByTestId("turnstile")).toBeTruthy());
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
    expect(mocks.addComment.mock.calls[0][0].turnstileToken).toBeUndefined();

    fireEvent.click(screen.getByTestId("turnstile"));
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.addComment.mock.calls.map((c) => c[0]);
    expect(second.turnstileToken).toBe("tok1");
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body).toBe("Có chỗ gửi xe không?");
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("visible"));
    // Token dùng một lần: sau mỗi lần gửi resetKey phải tăng.
    expect(Math.max(...mocks.resetKeys)).toBeGreaterThan(0);
  });

  it("send error keeps the text and shows the server message", async () => {
    mocks.addComment.mockResolvedValue({ error: "Bạn gửi quá nhanh" });
    const { onSent } = renderComposer();
    type("Câu hỏi của tôi");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Bạn gửi quá nhanh"),
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Câu hỏi của tôi",
    );
    expect(screen.queryByText("Đang gửi…")).toBeNull();
    expect(onSent).not.toHaveBeenCalled();
    // Không tự gửi lại.
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
  });

  it("held result shows the waiting label and toast", async () => {
    mocks.addComment.mockResolvedValue({
      success: true,
      data: { id: 4, status: "held" },
    });
    const { onSent } = renderComposer();
    type("Liên hệ 0901234567");
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledWith("held"));
    expect(mocks.toast.info).toHaveBeenCalledWith(
      "Bình luận có số điện thoại hoặc link nên chờ host duyệt",
    );
    expect(screen.getByText("Đang chờ host duyệt")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});
