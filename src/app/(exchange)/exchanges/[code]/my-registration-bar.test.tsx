// @vitest-environment jsdom
/**
 * Hủy đăng ký (g2b, Task 16). Luồng lạc quan phải hoàn lại khi lỗi, và hủy sau
 * hạn phải hỏi trước, không gửi gì đến khi người dùng xác nhận.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { makeEvent, makeViewer, makeReg } from "./fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  cancelMyRegistration: vi.fn<(i: { code: string }) => Promise<unknown>>(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/actions/exchange-registrations", () => actions);

const { MyRegistrationBar } = await import("./my-registration-bar");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const approved = { status: "approved", waitlistPos: null };

function renderBar(cancelDeadline: string) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <MyRegistrationBar
        event={makeEvent({ cancelDeadline })}
        viewer={makeViewer({
          role: "member",
          myRegistration: makeReg(),
        })}
        reg={approved}
        onChange={onChange}
        onRegister={() => {}}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

const cancelBtn = () => screen.getByRole("button", { name: "Huỷ" });

describe("MyRegistrationBar cancel", () => {
  it("cancel success shows cancelled and refreshes", async () => {
    actions.cancelMyRegistration.mockResolvedValue({ success: true });
    const onChange = renderBar("2030-01-15T08:00:00.000Z");
    fireEvent.click(cancelBtn());
    expect(onChange).toHaveBeenCalledWith({
      status: "cancelled",
      waitlistPos: null,
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(actions.cancelMyRegistration).toHaveBeenCalledWith({
      code: "ABCD1234",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancel error rolls back and shows the server message", async () => {
    actions.cancelMyRegistration.mockResolvedValue({
      error: "Đã quá hạn cho thao tác này.",
    });
    const onChange = renderBar("2030-01-15T08:00:00.000Z");
    fireEvent.click(cancelBtn());
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Đã quá hạn cho thao tác này."),
    );
    expect(onChange).toHaveBeenNthCalledWith(1, {
      status: "cancelled",
      waitlistPos: null,
    });
    expect(onChange).toHaveBeenLastCalledWith(approved);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(actions.cancelMyRegistration).toHaveBeenCalledTimes(1);
  });

  it("after the cancel deadline it asks first and sends nothing until confirmed", async () => {
    actions.cancelMyRegistration.mockResolvedValue({ success: true });
    const onChange = renderBar("2020-01-15T08:00:00.000Z");
    fireEvent.click(cancelBtn());
    expect(screen.getByText(/vẫn bị tính phí/)).toBeTruthy();
    expect(actions.cancelMyRegistration).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn huỷ" }));
    await waitFor(() =>
      expect(actions.cancelMyRegistration).toHaveBeenCalledTimes(1),
    );
    expect(onChange).toHaveBeenCalledWith({
      status: "cancelled",
      waitlistPos: null,
    });
  });
});

describe("MyRegistrationBar states", () => {
  function renderWith(
    reg: { status: string; waitlistPos: number | null },
    event: Parameters<typeof makeEvent>[0] = {},
  ) {
    render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <MyRegistrationBar
          event={makeEvent(event)}
          viewer={makeViewer({ role: "member", myRegistration: makeReg() })}
          reg={reg}
          onChange={() => {}}
          onRegister={() => {}}
        />
      </NextIntlClientProvider>,
    );
  }

  it("a pending registration past the cancel deadline cancels without the late-fee warning", async () => {
    actions.cancelMyRegistration.mockResolvedValue({ success: true });
    renderWith(
      { status: "pending", waitlistPos: null },
      { cancelDeadline: "2020-01-15T08:00:00.000Z" },
    );
    fireEvent.click(cancelBtn());
    expect(screen.queryByText(/vẫn bị tính phí/)).toBeNull();
    await waitFor(() =>
      expect(actions.cancelMyRegistration).toHaveBeenCalledTimes(1),
    );
  });

  it("checks the deadline when tapped, not when the page opened", () => {
    const deadline = Date.now() + 60_000;
    renderWith(approved, { cancelDeadline: new Date(deadline).toISOString() });
    const later = vi.spyOn(Date, "now").mockReturnValue(deadline + 1_000);
    try {
      fireEvent.click(cancelBtn());
      expect(screen.getByText(/vẫn bị tính phí/)).toBeTruthy();
      expect(actions.cancelMyRegistration).not.toHaveBeenCalled();
    } finally {
      later.mockRestore();
    }
  });

  it("a cancelled event says so instead of showing the active registration", () => {
    renderWith(approved, { status: "cancelled" });
    expect(screen.getByText("Buổi đã huỷ")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Huỷ" })).toBeNull();
  });

  it("a waitlisted member on a finished event sees the closed label", () => {
    renderWith({ status: "waitlist", waitlistPos: 2 }, { status: "done" });
    expect(screen.getByText("Buổi đã kết thúc")).toBeTruthy();
    expect(screen.queryByText(/Danh sách chờ/)).toBeNull();
  });
});

describe("MyRegistrationBar rating", () => {
  const END = Date.parse("2030-01-15T14:00:00.000Z");
  const DAY = 86_400_000;
  afterEach(() => vi.useRealTimers());

  function renderAt(
    nowMs: number,
    o: {
      checkedIn?: boolean;
      status?: string;
      event?: Parameters<typeof makeEvent>[0];
      onRate?: () => void;
    } = {},
  ) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    const status = o.status ?? "approved";
    render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <MyRegistrationBar
          event={makeEvent({ status: "done", ...o.event })}
          viewer={makeViewer({
            role: "member",
            myRegistration: makeReg({ status, checkedIn: o.checkedIn ?? true }),
          })}
          reg={{ status, waitlistPos: null }}
          onChange={() => {}}
          onRegister={() => {}}
          onRate={"onRate" in o ? o.onRate : vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const btn = screen.queryByRole("button", { name: "Đánh giá buổi này" });
    cleanup();
    vi.useRealTimers();
    return btn;
  }

  it("the bar shows Đánh giá buổi này only from endAt to endAt plus 7 days for a checked-in registrant, never on a hidden or cancelled event", () => {
    expect(renderAt(END - 1)).toBeNull();
    expect(renderAt(END)).not.toBeNull();
    expect(renderAt(END + 3 * DAY)).not.toBeNull();
    // Đúng mốc endAt + 7 ngày server đã coi là đóng (windowClosed).
    expect(renderAt(END + 7 * DAY - 1)).not.toBeNull();
    expect(renderAt(END + 7 * DAY)).toBeNull();
    expect(renderAt(END + DAY, { checkedIn: false })).toBeNull();
    expect(renderAt(END + DAY, { status: "cancelled" })).toBeNull();
    expect(renderAt(END + DAY, { event: { hidden: true } })).toBeNull();
    expect(renderAt(END + DAY, { event: { status: "cancelled" } })).toBeNull();
    expect(renderAt(END + DAY, { onRate: undefined })).toBeNull();
  });

  it("tapping Đánh giá buổi này calls onRate", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(END + DAY);
    const onRate = vi.fn();
    render(
      <NextIntlClientProvider locale="vi" messages={viMessages}>
        <MyRegistrationBar
          event={makeEvent({ status: "done" })}
          viewer={makeViewer({
            role: "member",
            myRegistration: makeReg({ checkedIn: true }),
          })}
          reg={approved}
          onChange={() => {}}
          onRegister={() => {}}
          onRate={onRate}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Đánh giá buổi này" }));
    expect(onRate).toHaveBeenCalledTimes(1);
  });
});
