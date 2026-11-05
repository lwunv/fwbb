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
