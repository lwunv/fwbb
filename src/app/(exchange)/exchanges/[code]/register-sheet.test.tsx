// @vitest-environment jsdom
/**
 * Sheet đăng ký (g2b, Task 16). Điều dễ hỏng im lặng:
 * 1. Tài khoản mới không được thấy ô "người đi cùng" (server cũng chặn).
 * 2. Token Turnstile dùng một lần: lỗi hay thành công đều phải xin token mới,
 *    và không được tự gửi lại cùng token (retry: false).
 * 3. Lỗi server hiện nguyên văn và trạng thái lạc quan phải được hoàn lại.
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
import { registrationFee } from "@/lib/exchange-fee";
import { formatVND } from "@/lib/utils";
import { makeEvent, makeViewer } from "./fixtures";

const widget = vi.hoisted(
  () =>
    ({}) as {
      action: string;
      onToken: (t: string | null) => void;
      resetKey: number;
    },
);
const actions = vi.hoisted(() => ({
  registerForExchange:
    vi.fn<(i: Record<string, unknown>) => Promise<unknown>>(),
  cancelMyRegistration: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/actions/exchange-registrations", () => actions);
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    action: string;
    onToken: (t: string | null) => void;
    resetKey: number;
  }) => {
    widget.action = p.action;
    widget.onToken = p.onToken;
    widget.resetKey = p.resetKey;
    return <div data-testid="turnstile" />;
  },
}));

const { RegisterSheet } = await import("./register-sheet");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function renderSheet(
  viewer = makeViewer({ role: "member" }),
  event = makeEvent(),
) {
  const handlers = {
    onOptimistic: vi.fn(),
    onRollback: vi.fn(),
    onRegistered: vi.fn(),
  };
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <RegisterSheet
        open
        onOpenChange={() => {}}
        event={event}
        viewer={viewer}
        memberGender="male"
        {...handlers}
      />
    </NextIntlClientProvider>,
  );
  return handlers;
}

describe("RegisterSheet", () => {
  it("register sheet hides companions for a new account and warns on skill", () => {
    renderSheet(
      makeViewer({ role: "member", isNewAccount: true, skillWarning: "below" }),
    );
    expect(screen.queryByText("Người đi cùng")).toBeNull();
    expect(screen.getByText(/Trình độ của bạn thấp hơn/)).toBeTruthy();
    cleanup();
    renderSheet(makeViewer({ role: "member" }));
    expect(screen.getByText("Người đi cùng")).toBeTruthy();
    cleanup();
    renderSheet(
      makeViewer({ role: "member" }),
      makeEvent({ allowPlusOnes: false }),
    );
    expect(screen.queryByText("Người đi cùng")).toBeNull();
  });

  it("register error rolls back, shows the server message and resets Turnstile", async () => {
    actions.registerForExchange.mockResolvedValue({
      error: "Đã quá hạn cho thao tác này.",
    });
    const h = renderSheet();
    const before = widget.resetKey;
    act(() => widget.onToken("tok-1"));
    fireEvent.click(screen.getByRole("button", { name: "Gửi đăng ký" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Đã quá hạn cho thao tác này."),
    );
    expect(h.onOptimistic).toHaveBeenCalledTimes(1);
    expect(h.onRollback).toHaveBeenCalledTimes(1);
    expect(h.onRegistered).not.toHaveBeenCalled();
    // retry: false, nên token dùng một lần không bị gửi lại.
    expect(actions.registerForExchange).toHaveBeenCalledTimes(1);
    expect(actions.registerForExchange.mock.calls[0][0]).toMatchObject({
      code: "ABCD1234",
      maleCount: 1,
      femaleCount: 0,
      turnstileToken: "tok-1",
    });
    expect(widget.resetKey).toBe(before + 1);
  });

  it("register success reports the server status and resets Turnstile", async () => {
    actions.registerForExchange.mockResolvedValue({
      success: true,
      data: { status: "pending", waitlistPos: null },
    });
    const h = renderSheet();
    const before = widget.resetKey;
    act(() => widget.onToken("tok-2"));
    fireEvent.click(screen.getByRole("button", { name: "Gửi đăng ký" }));
    await waitFor(() =>
      expect(h.onRegistered).toHaveBeenCalledWith({
        status: "pending",
        waitlistPos: null,
      }),
    );
    expect(widget.resetKey).toBe(before + 1);
  });

  it("estimate uses the shared registrationFee helper", () => {
    renderSheet(
      makeViewer({ role: "member" }),
      makeEvent({ fee: { kind: "fixed", male: 80000, female: 50000 } }),
    );
    // Bạn là nam (1) cộng 1 nữ đi cùng.
    fireEvent.click(screen.getAllByRole("button", { name: "Tăng 1" })[1]);
    const expected = registrationFee(
      { male: 80000, female: 50000 },
      { maleCount: 1, femaleCount: 1 },
    );
    const norm = (x: string) => x.replace(/\s/g, " ");
    expect(
      screen.getByText(
        (_, el) =>
          el?.children.length === 0 &&
          norm(el.textContent ?? "") === norm(formatVND(expected)),
      ),
    ).toBeTruthy();
  });
});
