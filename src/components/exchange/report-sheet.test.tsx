// @vitest-environment jsdom
/**
 * Phiếu báo cáo (G2d Task 16). Điều dễ hỏng im lặng: thêm báo cáo theo đối
 * tượng (người chơi, sân, đánh giá) mà làm lệch cách gửi cũ (buổi, host, đăng
 * ký, bình luận), hoặc vẫn hiện lựa chọn "Báo cáo ai" khi đối tượng đã rõ.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
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

const { ReportSheet } = await import("./report-sheet");

beforeEach(() => {
  mocks.report.mockReset();
  mocks.report.mockResolvedValue({ success: true });
});
afterEach(cleanup);

function renderSheet(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

async function send() {
  fireEvent.click(screen.getByTestId("turnstile"));
  fireEvent.click(await screen.findByRole("button", { name: "Gửi báo cáo" }));
  await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
  return mocks.report.mock.calls[0][0];
}

describe("ReportSheet", () => {
  it.each([
    { type: "player", code: "abcdefghij" },
    { type: "venue", venueId: 5 },
    { type: "review", reviewId: 42 },
  ] as const)(
    "report sheet with a target sends it and hides the event or host choice ($type)",
    async (target) => {
      const onOpenChange = vi.fn();
      renderSheet(
        <ReportSheet open onOpenChange={onOpenChange} target={target} />,
      );
      expect(screen.queryByText("Báo cáo ai")).toBeNull();
      expect(screen.queryByText("Buổi này")).toBeNull();
      const input = await send();
      expect(input).toEqual({
        target,
        reason: "spam",
        note: undefined,
        turnstileToken: "tok",
      });
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "Đã gửi báo cáo. Cảm ơn bạn.",
      );
    },
  );

  it("existing report sheet uses keep working", async () => {
    // Buổi: mặc định "Buổi này", vẫn có lựa chọn "Báo cáo ai".
    renderSheet(<ReportSheet open onOpenChange={() => {}} code="ABCD1234" />);
    expect(screen.getByText("Báo cáo ai")).toBeTruthy();
    expect((await send()).target).toEqual({ type: "event", code: "ABCD1234" });
    cleanup();
    mocks.report.mockClear();

    // Host: chọn lại thì gửi theo host.
    renderSheet(<ReportSheet open onOpenChange={() => {}} code="ABCD1234" />);
    fireEvent.click(screen.getByLabelText("Host"));
    expect((await send()).target).toEqual({ type: "host", code: "ABCD1234" });
    cleanup();
    mocks.report.mockClear();

    // Đăng ký và bình luận: không có lựa chọn buổi/host.
    renderSheet(
      <ReportSheet
        open
        onOpenChange={() => {}}
        code="ABCD1234"
        registrationId={9}
      />,
    );
    expect(screen.queryByText("Báo cáo ai")).toBeNull();
    expect((await send()).target).toEqual({
      type: "registration",
      registrationId: 9,
    });
    cleanup();
    mocks.report.mockClear();

    renderSheet(
      <ReportSheet
        open
        onOpenChange={() => {}}
        code="ABCD1234"
        commentId={3}
      />,
    );
    expect(screen.queryByText("Báo cáo ai")).toBeNull();
    expect((await send()).target).toEqual({ type: "comment", commentId: 3 });
  });
});
