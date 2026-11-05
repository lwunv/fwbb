// @vitest-environment jsdom
/**
 * Trang quản lý của host (g2b, Task 17). Điều dễ hỏng im lặng:
 * 1. Công tắc "Đã trả" lạc quan phải hoàn lại khi server từ chối.
 * 2. Xem trước chốt phí dùng đúng `computeLockedFees`; `needsConfirm` phải hỏi lại.
 * 3. Số "đã trả" và "cần hoàn" đến từ server (`paidAmount`, `refundDue`), không tính lại.
 * 4. Điểm danh chỉ mở trong khung giờ của server.
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
import {
  computeLockedFees,
  registrationSettlement,
  type ExchangeFeeConfig,
} from "@/lib/exchange-fee";
import { formatVND } from "@/lib/utils";
import { makeEvent } from "../fixtures";
import type { ManageReg, ManageView } from "@/actions/exchange-host";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
const host = vi.hoisted(() => ({
  decideRegistration: vi.fn(),
  setDepositReceived: vi.fn(),
  increaseSlots: vi.fn(),
  settleWaitlist: vi.fn(),
  blockRegistrant: vi.fn(),
  unblockMember: vi.fn(),
  lockExchangeFees: vi.fn(),
  unlockExchangeFees: vi.fn(),
  setRegistrationPaid: vi.fn(),
  setCheckedIn: vi.fn(),
  markNoShow: vi.fn(),
  finishExchangeEvent: vi.fn(),
  cancelExchangeEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/actions/exchange-host", () => host);
vi.mock("@/actions/exchange-events", () => ({ updateExchangeEvent: vi.fn() }));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: vi.fn() }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

const { ManageClient } = await import("./manage-client");

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(host)) fn.mockResolvedValue({ success: true });
});

const feeConfig: ExchangeFeeConfig = {
  feeMode: "split_equal",
  feeAmountMale: null,
  feeAmountFemale: null,
  feeFemalePercent: null,
  estimatedTotalCost: 400000,
  minHeads: 4,
  hostHeads: 1,
};

function makeReg(over: Partial<ManageReg> = {}): ManageReg {
  const row: Omit<ManageReg, "received"> = {
    id: 1,
    status: "approved",
    name: "Lan Anh",
    avatarUrl: null,
    avatarKey: null,
    gender: "female",
    skillLevel: "tb",
    skillOutOfRange: false,
    isNewAccount: false,
    accountLocked: false,
    maleCount: 1,
    femaleCount: 0,
    note: null,
    waitlistPos: null,
    depositPaid: false,
    feeAmount: null,
    feeWaived: false,
    paid: false,
    paidAmount: null,
    refundDue: 0,
    remaining: 0,
    checkedIn: false,
    createdAt: "2030-01-02T00:00:00.000Z",
    ...over,
  };
  // The server fills `received` from registrationSettlement; mirror that here.
  return {
    ...row,
    received: over.received ?? registrationSettlement(row, 0).received,
  };
}

function makeView(over: Partial<ManageView> = {}): ManageView {
  return {
    eventId: 7,
    event: makeEvent(),
    feeConfig,
    hostContact: "",
    zaloGroupLink: "",
    regs: [],
    blocks: [],
    reserveOpened: false,
    ...over,
  };
}

function renderManage(view: ManageView) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <ManageClient view={view} />
    </NextIntlClientProvider>,
  );
}

const norm = (x: string) => x.replace(/\s/g, " ");
/** Phần tử lá có chữ chứa `text` (tiền VND có khoảng trắng đặc biệt nên chuẩn hoá). */
const hasText = (text: string) =>
  screen.queryAllByText(
    (_, el) =>
      !!el &&
      el.children.length === 0 &&
      norm(el.textContent ?? "").includes(norm(text)),
  ).length > 0;

describe("ManageClient", () => {
  it("toggling paid is optimistic and rolls back on error", async () => {
    host.setRegistrationPaid.mockResolvedValue({
      error: "Không đánh dấu được.",
    });
    renderManage(
      makeView({
        event: makeEvent({ status: "locked" }),
        regs: [makeReg({ feeAmount: 80000, remaining: 80000 })],
      }),
    );
    const pressed = () =>
      screen
        .getByRole("button", { name: "Đã trả" })
        .getAttribute("aria-pressed");
    expect(pressed()).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Đã trả" }));
    expect(pressed()).toBe("true");
    expect(host.setRegistrationPaid).toHaveBeenCalledWith({
      registrationId: 1,
      paid: true,
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Không đánh dấu được."),
    );
    await waitFor(() => expect(pressed()).toBe("false"));
  });

  it("lock sheet previews fees and shows the confirm step on needsConfirm", async () => {
    const regs = [
      makeReg({ id: 1, name: "An" }),
      makeReg({ id: 2, name: "Bình" }),
    ];
    const preview = computeLockedFees(
      feeConfig,
      regs.map((r) => ({ ...r, waived: false })),
    );
    host.lockExchangeFees.mockResolvedValueOnce({
      needsConfirm: {
        rates: { male: 150000, female: 150000 },
        estimate: { male: 80000, female: 80000 },
      },
    });
    renderManage(makeView({ regs }));
    fireEvent.click(screen.getByRole("button", { name: "Chốt phí" }));
    expect(hasText(formatVND(preview.fees[0].amount))).toBe(true);

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Miễn" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận chốt phí" }));
    await waitFor(() =>
      expect(host.lockExchangeFees).toHaveBeenCalledWith({
        eventId: 7,
        waivedRegistrationIds: [2],
        confirmAboveEstimate: false,
      }),
    );
    const again = await screen.findByRole("button", { name: "Vẫn chốt" });
    host.lockExchangeFees.mockResolvedValueOnce({
      success: true,
      data: { rates: { male: 150000, female: 150000 } },
    });
    fireEvent.click(again);
    await waitFor(() =>
      expect(host.lockExchangeFees).toHaveBeenLastCalledWith({
        eventId: 7,
        waivedRegistrationIds: [2],
        confirmAboveEstimate: true,
      }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("refund due and paid-difference lines render from paidAmount and refundDue", () => {
    renderManage(
      makeView({
        event: makeEvent({ status: "locked" }),
        regs: [
          makeReg({
            id: 1,
            name: "Trả dư",
            feeAmount: 80000,
            paid: true,
            paidAmount: 100000,
            refundDue: 20000,
          }),
          makeReg({
            id: 2,
            name: "Trả thiếu",
            feeAmount: 120000,
            paid: true,
            paidAmount: 100000,
            remaining: 20000,
          }),
        ],
      }),
    );
    expect(hasText(`Đã trả ${formatVND(100000)}`)).toBe(true);
    expect(hasText(`Cần hoàn ${formatVND(20000)}`)).toBe(true);
    expect(hasText(`Chênh lệch: cần thu thêm ${formatVND(20000)}`)).toBe(true);
    expect(hasText(`Chênh lệch: cần hoàn ${formatVND(20000)}`)).toBe(true);
  });

  it("totals and the paid line read each row's received from the server, not a local formula", () => {
    renderManage(
      makeView({
        event: makeEvent({ status: "locked", depositAmount: 30000 }),
        regs: [
          // Legacy paid row without paidAmount: the helper falls back to the fee.
          makeReg({
            id: 1,
            name: "Trả cũ",
            feeAmount: 80000,
            paid: true,
            paidAmount: null,
            received: 80000,
          }),
          makeReg({
            id: 2,
            name: "Đã cọc",
            feeAmount: 80000,
            depositPaid: true,
            remaining: 50000,
            received: 30000,
          }),
        ],
      }),
    );
    // Đã thu = 80K + 30K.
    expect(hasText(formatVND(110000))).toBe(true);
    expect(hasText(`Đã trả ${formatVND(80000)}`)).toBe(true);
  });

  it("cancelled-after-lock banner asks to unlock and relock", () => {
    renderManage(
      makeView({
        event: makeEvent({ status: "locked" }),
        regs: [
          makeReg({ id: 1, status: "cancelled", feeAmount: 80000 }),
          makeReg({ id: 2, name: "Còn lại", feeAmount: 80000 }),
        ],
      }),
    );
    expect(screen.getByText("Cần mở khoá và chốt lại")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mở khoá để sửa" }));
    expect(host.unlockExchangeFees).toHaveBeenCalledWith({ eventId: 7 });
  });

  it("relock banner fires for cancelled and rejected but not late_cancelled", () => {
    const banner = (status: string) => {
      renderManage(
        makeView({
          event: makeEvent({ status: "locked" }),
          regs: [makeReg({ id: 1, status, feeAmount: 80000 })],
        }),
      );
      const shown = screen.queryByText("Cần mở khoá và chốt lại") !== null;
      cleanup();
      return shown;
    };
    expect(banner("cancelled")).toBe(true);
    expect(banner("rejected")).toBe(true);
    expect(banner("late_cancelled")).toBe(false);
  });

  it("reserve-opened banner runs settleWaitlist", async () => {
    host.settleWaitlist.mockResolvedValue({
      success: true,
      data: { promoted: 1 },
    });
    renderManage(
      makeView({
        reserveOpened: true,
        event: makeEvent({ femaleReservedSlots: 2 }),
        regs: [makeReg({ id: 3, status: "waitlist", waitlistPos: 1 })],
      }),
    );
    expect(screen.getByText("2 slot nữ đã mở")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xét danh sách chờ" }));
    await waitFor(() =>
      expect(host.settleWaitlist).toHaveBeenCalledWith({ eventId: 7 }),
    );
  });

  it("locked account label shows on its registration", () => {
    renderManage(
      makeView({
        regs: [makeReg({ accountLocked: true, isNewAccount: true })],
      }),
    );
    expect(screen.getByText("Tài khoản đã bị khoá")).toBeTruthy();
    expect(screen.getByText("Mới")).toBeTruthy();
  });

  it("check-in toggle disabled outside the window", () => {
    const iso = (offsetMs: number) =>
      new Date(Date.now() + offsetMs).toISOString();
    const later = iso(3 * 3_600_000);
    const soon = iso(10 * 60_000);
    const end = (s: string) =>
      new Date(new Date(s).getTime() + 2 * 3_600_000).toISOString();
    renderManage(
      makeView({
        event: makeEvent({ startAt: later, endAt: end(later) }),
        regs: [makeReg()],
      }),
    );
    expect(
      (screen.getByRole("button", { name: "Điểm danh" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    cleanup();
    renderManage(
      makeView({
        event: makeEvent({ startAt: soon, endAt: end(soon) }),
        regs: [makeReg()],
      }),
    );
    const open = screen.getByRole("button", {
      name: "Điểm danh",
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(host.setCheckedIn).toHaveBeenCalledWith({
      registrationId: 1,
      checkedIn: true,
    });
  });
});
