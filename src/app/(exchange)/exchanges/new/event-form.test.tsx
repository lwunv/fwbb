// @vitest-environment jsdom
/**
 * Form mở buổi giao lưu (g2b, Task 14). Các điều dễ hỏng im lặng:
 * 1. Xem trước phí phải dùng ĐÚNG hàm server (exchangeFeeEstimate) và nói rõ
 *    "tối đa" (chia đều) hay "khoảng" (nữ được giảm, chỉ là ước tính).
 * 2. Token Turnstile dùng một lần: sau mỗi lần gửi (kể cả lỗi) phải xin token
 *    mới, còn idempotencyKey giữ nguyên để gửi lại không tạo buổi thứ hai.
 * 3. Lỗi server hiện nguyên văn, không bị thay bằng lỗi Turnstile.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { exchangeFeeEstimate } from "@/lib/exchange-fee";
import { formatVND } from "@/lib/utils";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const widget = vi.hoisted(
  () =>
    ({}) as {
      action: string;
      onToken: (t: string | null) => void;
      resetKey: number;
    },
);
const actions = vi.hoisted(() => ({
  createExchangeEvent:
    vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/actions/exchange-events", () => actions);
vi.mock("@/components/security/turnstile-widget", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    TurnstileWidget: (p: {
      action: string;
      onToken: (t: string | null) => void;
      resetKey: number;
    }) => {
      widget.action = p.action;
      widget.onToken = p.onToken;
      widget.resetKey = p.resetKey;
      const last = useRef(p.resetKey);
      useEffect(() => {
        if (last.current === p.resetKey) return;
        last.current = p.resetKey;
        p.onToken(null);
      });
      return <div data-testid="turnstile" />;
    },
  };
});
vi.mock("./venue-picker", () => ({
  VenuePicker: (p: {
    onChange: (v: { id: number; name: string }) => void;
    value: { id: number; name: string } | null;
  }) => (
    <button type="button" onClick={() => p.onChange({ id: 7, name: "San A" })}>
      {p.value ? `venue:${p.value.name}` : "pick-venue"}
    </button>
  ),
}));

const { EventForm } = await import("./event-form");

type Payout = { bankBin: string; accountNo: string; accountName: string };

function renderForm(props: { initialPayout?: Payout | null } = {}) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <EventForm initialPayout={props.initialPayout ?? null} />
    </NextIntlClientProvider>,
  );
}

function give(token: string | null) {
  act(() => widget.onToken(token));
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function money(label: string, value: number) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value: String(value) } });
  fireEvent.blur(el);
}

function openMore() {
  fireEvent.click(screen.getByRole("button", { name: /Tuỳ chọn thêm/ }));
}

function chooseMode(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}

/** Điền đủ các ô bắt buộc cho cách thu "một mức cố định". */
function fillValid() {
  fireEvent.click(screen.getByRole("button", { name: "pick-venue" }));
  type("Ngày", "2030-01-15");
  type("Bắt đầu", "19:00");
  type("Kết thúc", "21:00");
  type("Tiêu đề", "Giao lưu tối thứ ba");
  money("Phí mỗi người", 50000);
  openMore();
  type(
    "Liên hệ (không bắt buộc): số điện thoại hoặc link zalo.me",
    "0912345678",
  );
}

function submitButton() {
  return screen.getByRole("button", { name: /Mở buổi/ }) as HTMLButtonElement;
}

beforeEach(() => {
  widget.action = "";
  widget.resetKey = 0;
  router.push.mockReset();
  toast.error.mockReset();
  actions.createExchangeEvent.mockReset();
});
afterEach(cleanup);

describe("EventForm: xem trước phí", () => {
  it("split_equal preview shows the cap at minHeads; female discount preview says it is an estimate", () => {
    renderForm();
    chooseMode("Chia đều tiền sân");
    money("Tổng tiền dự kiến (sân, cầu)", 300000);

    const cfg = {
      feeMode: "split_equal" as const,
      feeAmountMale: null,
      feeAmountFemale: null,
      feeFemalePercent: null,
      estimatedTotalCost: 300000,
      minHeads: 6,
      hostHeads: 1,
    };
    const cap = formatVND(exchangeFeeEstimate(cfg).male);
    const preview = screen.getByTestId("fee-preview");
    expect(preview.textContent).toContain(`Tối đa ${cap}/người khi có 6 người`);

    chooseMode("Chia đều, nữ được giảm");
    const est = formatVND(
      exchangeFeeEstimate({
        ...cfg,
        feeMode: "split_female_discount",
        feeFemalePercent: 50,
      }).male,
    );
    const after = screen.getByTestId("fee-preview").textContent ?? "";
    expect(after).toContain(`Khoảng ${est}/người khi có 6 người nam`);
    expect(after).toContain("ước tính");
    expect(after).not.toContain("Tối đa");
  });

  it("fixed_gender asks for both amounts", () => {
    renderForm();
    expect(screen.queryByLabelText("Phí nữ")).toBeNull();
    chooseMode("Nam, nữ khác mức");
    expect(screen.getByLabelText("Phí nam")).toBeTruthy();
    expect(screen.getByLabelText("Phí nữ")).toBeTruthy();
  });
});

describe("EventForm: tài khoản nhận tiền", () => {
  it("payout prefilled from the last event", () => {
    renderForm({
      initialPayout: {
        bankBin: "970416",
        accountNo: "123456789",
        accountName: "NGUYEN VAN A",
      },
    });
    openMore();
    expect(
      (screen.getByLabelText("Số tài khoản") as HTMLInputElement).value,
    ).toBe("123456789");
    expect(
      (
        screen.getByLabelText(
          "Tên chủ tài khoản (IN HOA, không dấu)",
        ) as HTMLInputElement
      ).value,
    ).toBe("NGUYEN VAN A");
    expect(screen.getByText("ACB")).toBeTruthy();
  });
});

describe("EventForm: gửi form", () => {
  it("retry after an error sends the same idempotencyKey and a new Turnstile token", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({ error: "Lỗi A" });
    renderForm();
    fillValid();
    give("tok-1");
    expect(widget.action).toBe("exchange_open");

    fireEvent.click(submitButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Lỗi A"));
    const first = actions.createExchangeEvent.mock.calls[0][0];
    expect(first.turnstileToken).toBe("tok-1");
    // Token cũ đã dùng: widget phải được xin lại, nút khoá tới khi có token mới.
    expect(widget.resetKey).toBe(1);
    expect(submitButton().disabled).toBe(true);

    give("tok-2");
    actions.createExchangeEvent.mockResolvedValueOnce({ error: "Lỗi B" });
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Lỗi B"));
    const second = actions.createExchangeEvent.mock.calls[1][0];
    expect(second.turnstileToken).toBe("tok-2");
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(widget.resetKey).toBe(2);
  });

  it("server error text is shown as-is, not replaced by a Turnstile error", async () => {
    const text =
      "Tiền cọc không được cao hơn mức phí thấp nhất mỗi người phải trả.";
    actions.createExchangeEvent.mockResolvedValueOnce({ error: text });
    renderForm();
    fillValid();
    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(text);
    expect(router.push).not.toHaveBeenCalled();
    // Form còn nguyên để sửa rồi gửi lại.
    expect((screen.getByLabelText("Tiêu đề") as HTMLInputElement).value).toBe(
      "Giao lưu tối thứ ba",
    );
  });

  it("success navigates to the new code", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({
      success: true,
      data: { code: "abc123" },
    });
    renderForm();
    fillValid();
    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/exchanges/abc123"),
    );
    const input = actions.createExchangeEvent.mock.calls[0][0];
    expect(input.venueId).toBe(7);
    expect(input.feeMode).toBe("fixed");
    expect(input.feeAmountMale).toBe(50000);
  });

  it("fixed female fee shows the estimate and submits feeAmountFemale with no percent", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({
      success: true,
      data: { code: "fem001" },
    });
    renderForm();
    fillValid();
    chooseMode("Chia đều, nữ được giảm");
    money("Tổng tiền dự kiến (sân, cầu)", 600000);
    fireEvent.change(screen.getByLabelText("Số người dự kiến"), {
      target: { value: "5" },
    });
    fireEvent.click(
      screen.getByRole("radio", { name: "Số tiền cố định cho nữ" }),
    );
    money("Phí cố định cho nữ", 50000);

    const est = formatVND(
      exchangeFeeEstimate({
        feeMode: "split_female_discount",
        feeAmountMale: null,
        feeAmountFemale: 50000,
        feeFemalePercent: null,
        estimatedTotalCost: 600000,
        minHeads: 5,
        hostHeads: 1,
      }).male,
    );
    expect(screen.getByTestId("fee-preview").textContent).toContain(
      `Khoảng ${est}/người khi có 5 người nam`,
    );

    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() => expect(actions.createExchangeEvent).toHaveBeenCalled());
    const sent = actions.createExchangeEvent.mock.calls[0][0];
    expect(sent.feeMode).toBe("split_female_discount");
    expect(sent.feeAmountFemale).toBe(50000);
    expect(sent.feeFemalePercent).toBeUndefined();
  });

  it("percent female discount sends the percent and no fixed amount", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({
      success: true,
      data: { code: "fem002" },
    });
    renderForm();
    fillValid();
    chooseMode("Chia đều, nữ được giảm");
    money("Tổng tiền dự kiến (sân, cầu)", 600000);
    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() => expect(actions.createExchangeEvent).toHaveBeenCalled());
    const sent = actions.createExchangeEvent.mock.calls[0][0];
    expect(sent.feeFemalePercent).toBe(50);
    expect(sent.feeAmountFemale).toBeUndefined();
  });

  it("submits without a host contact", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({
      success: true,
      data: { code: "nc0001" },
    });
    renderForm();
    fillValid();
    type("Liên hệ (không bắt buộc): số điện thoại hoặc link zalo.me", "");
    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/exchanges/nc0001"),
    );
  });

  it("does not send without a Turnstile token", () => {
    renderForm();
    fillValid();
    fireEvent.click(submitButton());
    expect(actions.createExchangeEvent).not.toHaveBeenCalled();
  });

  it("a deposit disables auto-approve and sends autoApprove false", async () => {
    actions.createExchangeEvent.mockResolvedValueOnce({
      success: true,
      data: { code: "zzz999" },
    });
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("switch", { name: "Tự duyệt đăng ký" }));
    money("Tiền cọc", 20000);
    const sw = screen.getByRole("switch", { name: "Tự duyệt đăng ký" });
    expect(
      (sw as HTMLButtonElement).disabled ||
        sw.getAttribute("aria-disabled") === "true" ||
        sw.hasAttribute("data-disabled"),
    ).toBe(true);
    expect(screen.getByText(/duyệt thủ công/)).toBeTruthy();
    give("tok-1");
    fireEvent.click(submitButton());
    await waitFor(() => expect(actions.createExchangeEvent).toHaveBeenCalled());
    expect(actions.createExchangeEvent.mock.calls[0][0].autoApprove).toBe(
      false,
    );
  });
});
