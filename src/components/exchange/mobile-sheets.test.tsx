// @vitest-environment jsdom
/**
 * Bố cục mobile của luồng giao lưu (Task 21). Điều dễ hỏng im lặng:
 * 1. Nút chính của sheet phải dính đáy (vùng ngón cái) kể cả khi form dài cuộn.
 * 2. Hỏi lại huỷ muộn và admin huỷ buổi là bottom sheet trên mobile (R20).
 * 3. Vùng chạm ≥ 44px, chữ thông tin chính ≥ 16px.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import viMessages from "@/i18n/messages/vi.json";
import type { ManageReg } from "@/actions/exchange-host";
import type { AdminExchangeRow } from "@/actions/exchange-admin";
import {
  makeEvent,
  makeReg,
  makeViewer,
} from "@/app/(exchange)/giao-luu/[code]/fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const admin = vi.hoisted(() => ({
  adminCancelExchange: vi.fn(),
  adminListExchanges: vi.fn(),
  adminListReports: vi.fn(),
  adminResolveReport: vi.fn(),
  adminSetExchangeHidden: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/actions/exchange-registrations", () => ({
  registerForExchange: vi.fn(),
  cancelMyRegistration: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: vi.fn() }));
vi.mock("@/actions/exchange-host", () => ({
  increaseSlots: vi.fn(),
  lockExchangeFees: vi.fn(),
}));
vi.mock("@/actions/exchange-events", () => ({ updateExchangeEvent: vi.fn() }));
vi.mock("@/actions/exchange-admin", () => admin);
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

const { ResponsiveSheet } = await import("./responsive-sheet");
const { RegisterSheet } =
  await import("@/app/(exchange)/giao-luu/[code]/register-sheet");
const { ReportSheet } = await import("./report-sheet");
const { EditEventSheet } =
  await import("@/app/(exchange)/giao-luu/[code]/quan-ly/edit-event-sheet");
const { LockFeeSheet } =
  await import("@/app/(exchange)/giao-luu/[code]/quan-ly/lock-fee-sheet");
const { MyRegistrationBar } =
  await import("@/app/(exchange)/giao-luu/[code]/my-registration-bar");
const { AdminExchangeClient } =
  await import("@/app/(admin)/admin/giao-luu/admin-exchange-client");
const { EventPost } =
  await import("@/app/(exchange)/giao-luu/[code]/event-post");
const { ExchangeCard } = await import("./exchange-card");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const footer = () =>
  document.querySelector<HTMLElement>('[data-slot="responsive-sheet-footer"]');

describe("sticky primary action in exchange sheets", () => {
  it("ResponsiveSheet renders the footer sticky at the bottom with safe-area padding on mobile", () => {
    wrap(
      <ResponsiveSheet
        open
        onOpenChange={() => {}}
        title="T"
        footer={<button type="button">Go</button>}
      >
        <p>body</p>
      </ResponsiveSheet>,
    );
    const f = footer();
    expect(f).not.toBeNull();
    expect(f!.className).toMatch(/\bsticky\b/);
    expect(f!.className).toMatch(/\bbottom-0\b/);
    expect(f!.className).toMatch(/safe-area-inset-bottom/);
    expect(f!.className).toMatch(/backdrop-blur/);
    expect(f!.textContent).toBe("Go");
  });

  it("register, report, edit and lock sheets put their submit button in the sticky footer", () => {
    const sheets: [string, React.ReactNode][] = [
      [
        "Đang kiểm tra bảo mật",
        <RegisterSheet
          key="r"
          open
          onOpenChange={() => {}}
          event={makeEvent()}
          viewer={makeViewer({ role: "member" })}
          memberGender="male"
          onOptimistic={() => {}}
          onRollback={() => {}}
          onRegistered={() => {}}
        />,
      ],
      [
        "Đang kiểm tra bảo mật",
        <ReportSheet key="p" open onOpenChange={() => {}} code="ABCD1234" />,
      ],
      [
        "Lưu",
        <EditEventSheet
          key="e"
          open
          onOpenChange={() => {}}
          eventId={7}
          slotsTotal={10}
          description=""
          hostContact=""
          zaloGroupLink=""
          onSlots={() => {}}
          onSaved={() => {}}
        />,
      ],
      [
        "Xác nhận chốt phí",
        <LockFeeSheet
          key="l"
          open
          onOpenChange={() => {}}
          eventId={7}
          feeConfig={{
            feeMode: "fixed",
            feeAmountMale: 50000,
            feeAmountFemale: null,
            feeFemalePercent: null,
            estimatedTotalCost: null,
            minHeads: null,
            hostHeads: 1,
          }}
          regs={[
            {
              id: 1,
              status: "approved",
              name: "Lan",
              maleCount: 1,
              femaleCount: 0,
            } as ManageReg,
          ]}
          onLocked={() => {}}
        />,
      ],
    ];
    for (const [label, ui] of sheets) {
      wrap(ui);
      const f = footer();
      expect(f, label).not.toBeNull();
      expect(f!.querySelector("button")?.textContent).toContain(label);
      cleanup();
    }
  });
});

describe("exchange confirmations are bottom sheets on mobile (R20)", () => {
  it("late cancel asks in a bottom sheet with 44px actions in the sticky footer", async () => {
    const { cancelMyRegistration } =
      await import("@/actions/exchange-registrations");
    wrap(
      <MyRegistrationBar
        event={makeEvent({ cancelDeadline: "2020-01-15T08:00:00.000Z" })}
        viewer={makeViewer({ role: "member", myRegistration: makeReg() })}
        reg={{ status: "approved", waitlistPos: null }}
        onChange={() => {}}
        onRegister={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    const sheet = document.querySelector('[data-side="bottom"]');
    expect(sheet).not.toBeNull();
    const body = screen.getByText(/vẫn bị tính phí/);
    expect(body.className).toMatch(/\btext-base\b/);
    const f = footer();
    expect(f).not.toBeNull();
    const confirm = screen.getByRole("button", { name: "Vẫn huỷ" });
    expect(f!.contains(confirm)).toBe(true);
    expect(confirm.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(confirm);
    await waitFor(() => expect(cancelMyRegistration).toHaveBeenCalledTimes(1));
  });

  it("admin cancel asks in a bottom sheet, not inline in the card", async () => {
    admin.adminCancelExchange.mockResolvedValue({ success: true });
    const row: AdminExchangeRow = {
      id: 3,
      publicCode: "XYZ123",
      title: "Buổi tối",
      status: "open",
      startAt: "2030-01-15T12:00:00.000Z",
      hiddenAt: null,
      hostName: "H",
      venueName: "V",
      slotsTotal: 10,
      holdingHeads: 2,
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="vi" messages={viMessages}>
          <AdminExchangeClient initialEvents={[row]} initialReports={[]} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Huỷ buổi" }));
    const sheet = document.querySelector('[data-side="bottom"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("không hoàn tác được");
    const f = footer();
    expect(f).not.toBeNull();
    const yes = Array.from(f!.querySelectorAll("button")).find(
      (b) => b.textContent === "Huỷ buổi",
    )!;
    expect(yes.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(yes);
    await waitFor(() =>
      expect(admin.adminCancelExchange).toHaveBeenCalledWith({ eventId: 3 }),
    );
  });
});

describe("touch targets and text sizes", () => {
  it("event-post venue chip link is 44px tall; plain chips are not stretched", () => {
    wrap(
      <EventPost
        event={makeEvent()}
        viewer={makeViewer()}
        memberGender={null}
      />,
    );
    const venue = screen.getByRole("link", { name: /Sân Cầu Lông Tân Bình/ });
    expect(venue.className).toMatch(/\bmin-h-11\b/);
    const shuttle = screen.getByText(/Yonex AS50/);
    expect(shuttle.className).not.toMatch(/\bmin-h-11\b/);
  });

  it("exchange card date line and fee pill are 16px text", () => {
    const { container } = wrap(
      <ExchangeCard
        event={
          {
            code: "abc123",
            title: "T",
            startAt: "2099-06-01T12:00:00.000Z",
            endAt: "2099-06-01T14:00:00.000Z",
            status: "open",
            skillMin: null,
            skillMax: null,
            slotsTotal: 10,
            venue: { id: 1, name: "Sân A", lat: 1, lng: 1, areaLabel: null },
            host: { name: "H", avatarUrl: null, avatarKey: null },
            fee: { kind: "fixed", male: 50000, female: 50000 },
            counts: { freeTotal: 5, freeFemaleOnly: 0 },
            distanceM: null,
          } as never
        }
      />,
    );
    const date = container.querySelector("p.text-primary");
    expect(date?.className).toMatch(/\btext-base\b/);
    const pill = container.querySelector("span.rounded-full.bg-primary\\/15");
    expect(pill?.className).toMatch(/\btext-base\b/);
  });
});
