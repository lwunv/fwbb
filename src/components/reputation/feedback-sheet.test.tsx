// @vitest-environment jsdom
/**
 * Phiếu chấm sau buổi (G2d Task 18). Điều dễ hỏng im lặng:
 * 1. Gửi lại sau lỗi phải giữ `idempotencyKey` nhưng dùng token Turnstile mới,
 *    và không bao giờ tự thử lại (token dùng một lần).
 * 2. Chỉ gửi người chơi cùng đã đổi; xoá hết câu trả lời cho một người thì gửi
 *    dòng rỗng để server xoá.
 * 3. Người không được điểm danh không thấy tên ai.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { FeedbackForm } from "@/actions/reputation";

const mocks = vi.hoisted(() => ({
  form: vi.fn(),
  submit: vi.fn(),
  report: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  tok: { n: 0 },
}));
vi.mock("@/actions/reputation", () => ({
  getEventFeedbackForm: mocks.form,
  submitEventFeedback: mocks.submit,
}));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: mocks.report }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    onToken: (t: string | null) => void;
    action: string;
  }) => (
    <button
      type="button"
      data-testid={`turnstile-${p.action}`}
      onClick={() => p.onToken(`tok-${++mocks.tok.n}`)}
    >
      ts
    </button>
  ),
}));

const { FeedbackSheet } = await import("./feedback-sheet");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function peer(
  registrationId: number,
  name: string,
  code: string | null,
  mine: FeedbackForm["peers"][number]["mine"] = null,
): FeedbackForm["peers"][number] {
  return { registrationId, name, avatarUrl: null, avatarKey: null, code, mine };
}

function formData(over: Partial<FeedbackForm> = {}): FeedbackForm {
  return {
    state: "open",
    closesAt: "2030-01-22T14:00:00.000Z",
    host: {
      name: "Minh Host",
      avatarUrl: null,
      avatarKey: null,
      code: "hostcode01",
    },
    hostAnswer: null,
    peers: [
      peer(21, "An Nguyễn", "ancode0001"),
      peer(22, "Bình", null),
      peer(23, "Chi", "chicode001"),
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tok.n = 0;
  mocks.submit.mockResolvedValue({ success: true, data: { saved: 2 } });
  mocks.report.mockResolvedValue({ success: true });
});
afterEach(cleanup);

function wrap(ui: ReactElement, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderSheet(data: FeedbackForm, onOpenChange = vi.fn()) {
  mocks.form.mockResolvedValue({ success: true, data });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    wrap(
      <FeedbackSheet open onOpenChange={onOpenChange} code="ABCD1234" />,
      client,
    ),
  );
  return { ...view, client, onOpenChange };
}

const hostQ = (label: string) =>
  screen.getByRole("radiogroup", { name: label });
function answerHost(asDescribed: "Có" | "Không", fee: "Có" | "Không") {
  fireEvent.click(
    within(hostQ("Buổi đúng như mô tả?")).getByRole("radio", {
      name: asDescribed,
    }),
  );
  fireEvent.click(
    within(hostQ("Phí đúng như đã báo?")).getByRole("radio", { name: fee }),
  );
}
const card = (name: string) => screen.getByRole("group", { name });
const submitBtn = () => screen.getByRole("button", { name: "Gửi đánh giá" });
// Sau mỗi lần gửi token cũ bị bỏ: nút chờ Turnstile cấp token mới.
const waitingBtn = () =>
  screen.getByRole("button", { name: "Đang kiểm tra bảo mật..." });
const token = () =>
  fireEvent.click(screen.getByTestId("turnstile-exchange_feedback"));

describe("FeedbackSheet", () => {
  it("submit sends both host answers and only touched co-players", async () => {
    const { onOpenChange, client } = renderSheet(formData());
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await screen.findByText("An Nguyễn");
    expect(mocks.form).toHaveBeenCalledWith("ABCD1234");
    expect(
      screen.getByText(/Điểm chỉ hiện trên hồ sơ sau khi buổi đóng chấm/),
    ).toBeTruthy();

    answerHost("Có", "Không");
    fireEvent.click(
      within(card("An Nguyễn")).getByRole("button", { name: "Đúng giờ" }),
    );
    // Bấm lại để bỏ: Chi về như chưa đụng, nên không bị gửi.
    const chiTb = within(card("Chi")).getByRole("button", { name: "TB" });
    fireEvent.click(chiTb);
    expect(chiTb.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chiTb);
    expect(chiTb.getAttribute("aria-pressed")).toBe("false");

    token();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][0]).toEqual({
      code: "ABCD1234",
      host: { asDescribed: true, feeAsPromised: false },
      peers: [
        {
          registrationId: 21,
          playAgain: false,
          tags: ["on_time"],
          skill: null,
        },
      ],
      idempotencyKey: expect.stringMatching(UUID),
      turnstileToken: "tok-1",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.toast.success).toHaveBeenCalledWith("Đã gửi đánh giá");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["exchange-feedback", "ABCD1234"],
    });
  });

  it("report link opens a player report and is hidden without a code", async () => {
    renderSheet(formData());
    await screen.findByText("An Nguyễn");
    expect(
      within(card("Bình")).queryByRole("button", { name: "Báo cáo" }),
    ).toBeNull();
    fireEvent.click(
      within(card("An Nguyễn")).getByRole("button", { name: "Báo cáo" }),
    );
    fireEvent.click(await screen.findByTestId("turnstile-exchange_report"));
    fireEvent.click(await screen.findByRole("button", { name: "Gửi báo cáo" }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
    expect(mocks.report.mock.calls[0][0].target).toEqual({
      type: "player",
      code: "ancode0001",
    });
  });

  it("after an error the resend keeps the idempotencyKey, uses a new token and never retries", async () => {
    mocks.submit
      .mockResolvedValueOnce({ error: "Chưa lưu được đánh giá" })
      .mockResolvedValue({ success: true, data: { saved: 1 } });
    const { rerender, client, onOpenChange } = renderSheet(formData());
    await screen.findByText("An Nguyễn");
    answerHost("Có", "Có");
    token();
    fireEvent.click(submitBtn());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Chưa lưu được đánh giá"),
    );
    // Không tự thử lại: token đã dùng thì cần token mới.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect((waitingBtn() as HTMLButtonElement).disabled).toBe(true);

    token();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.submit.mock.calls.map((c) => c[0]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.turnstileToken).toBe("tok-1");
    expect(second.turnstileToken).toBe("tok-2");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // Sau khi thành công, lần gửi kế tiếp có khoá mới.
    rerender(
      wrap(
        <FeedbackSheet
          open={false}
          onOpenChange={onOpenChange}
          code="ABCD1234"
        />,
        client,
      ),
    );
    rerender(
      wrap(
        <FeedbackSheet open onOpenChange={onOpenChange} code="ABCD1234" />,
        client,
      ),
    );
    await screen.findByText("An Nguyễn");
    answerHost("Có", "Có");
    token();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2][0].idempotencyKey).toMatch(UUID);
    expect(mocks.submit.mock.calls[2][0].idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
  });

  it("an error rolls back the sent state with the server message", async () => {
    let resolve!: (v: unknown) => void;
    mocks.submit.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderSheet(formData());
    await screen.findByText("An Nguyễn");
    answerHost("Không", "Không");
    token();
    fireEvent.click(submitBtn());
    // Lạc quan: "Đã gửi" ngay khi bấm, trước khi server trả lời.
    expect(await screen.findByRole("button", { name: "Đã gửi" })).toBeTruthy();
    resolve({ error: "Bạn thao tác quá nhanh" });
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Bạn thao tác quá nhanh"),
    );
    expect(screen.queryByRole("button", { name: "Đã gửi" })).toBeNull();
    expect(waitingBtn()).toBeTruthy();
    token();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reopening prefills the viewer's own answers", async () => {
    renderSheet(
      formData({
        hostAnswer: { asDescribed: true, feeAsPromised: false },
        peers: [
          peer(21, "An Nguyễn", "ancode0001", {
            playAgain: true,
            tags: ["friendly"],
            skill: "tb",
          }),
          peer(22, "Bình", null),
        ],
      }),
    );
    await screen.findByText("An Nguyễn");
    const checked = (q: string, name: string) =>
      within(hostQ(q))
        .getByRole("radio", { name })
        .getAttribute("aria-checked");
    expect(checked("Buổi đúng như mô tả?", "Có")).toBe("true");
    expect(checked("Phí đúng như đã báo?", "Không")).toBe("true");
    const an = card("An Nguyễn");
    const sw = within(an).getByRole("switch", { name: "Muốn chơi lại cùng" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(
      within(an)
        .getByRole("button", { name: "Vui vẻ" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(an)
        .getByRole("button", { name: "TB" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // Xoá hết câu trả lời của An: gửi dòng rỗng để server xoá lượt chấm đó.
    fireEvent.click(sw);
    fireEvent.click(within(an).getByRole("button", { name: "Vui vẻ" }));
    fireEvent.click(within(an).getByRole("button", { name: "TB" }));
    token();
    fireEvent.click(submitBtn());
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit.mock.calls[0][0].host).toEqual({
      asDescribed: true,
      feeAsPromised: false,
    });
    expect(mocks.submit.mock.calls[0][0].peers).toEqual([
      { registrationId: 21, playAgain: false, tags: [], skill: null },
    ]);
  });

  it("submit waits for both host answers", async () => {
    renderSheet(formData());
    await screen.findByText("An Nguyễn");
    token();
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Trả lời 2 câu về host để gửi")).toBeTruthy();
    fireEvent.click(
      within(hostQ("Buổi đúng như mô tả?")).getByRole("radio", { name: "Có" }),
    );
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submitBtn());
    fireEvent.click(
      within(hostQ("Phí đúng như đã báo?")).getByRole("radio", { name: "Có" }),
    );
    await waitFor(() =>
      expect((submitBtn() as HTMLButtonElement).disabled).toBe(false),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("notEligible shows the explanation and no names", async () => {
    const { container } = renderSheet(
      formData({ state: "notEligible", peers: [] }),
    );
    expect(
      await screen.findByText(
        "Chỉ người được host điểm danh ở buổi này mới đánh giá được.",
      ),
    ).toBeTruthy();
    expect(container.ownerDocument.body.textContent).not.toContain("Minh Host");
    expect(screen.queryByRole("button", { name: "Gửi đánh giá" })).toBeNull();
    expect(screen.queryByTestId("turnstile-exchange_feedback")).toBeNull();
    cleanup();

    renderSheet(formData({ state: "closed" }));
    expect(
      await screen.findByText("Đã hết 7 ngày đánh giá buổi này."),
    ).toBeTruthy();
    expect(screen.queryByText("An Nguyễn")).toBeNull();
    cleanup();

    renderSheet(formData({ state: "notYet" }));
    expect(
      await screen.findByText(
        "Buổi chưa kết thúc. Bạn đánh giá được từ giờ kết thúc, trong 7 ngày.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("An Nguyễn")).toBeNull();
  });

  it("a load error shows the server message", async () => {
    mocks.form.mockResolvedValue({
      error: "Không tìm thấy buổi giao lưu này.",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      wrap(
        <FeedbackSheet open onOpenChange={vi.fn()} code="ABCD1234" />,
        client,
      ),
    );
    expect(
      await screen.findByText("Không tìm thấy buổi giao lưu này."),
    ).toBeTruthy();
  });
});
