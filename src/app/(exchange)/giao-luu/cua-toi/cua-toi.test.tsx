// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const mocks = vi.hoisted(() => ({
  viewer: { current: {} as Record<string, unknown> },
  mine: vi.fn(),
  settings: vi.fn(),
  unblock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/member-auth", () => ({
  getExchangeViewer: async () => mocks.viewer.current,
}));
vi.mock("@/actions/exchange-mine", () => ({ getMyExchanges: mocks.mine }));
vi.mock("@/actions/settings", () => ({ getSettings: mocks.settings }));
vi.mock("@/actions/exchange-host", () => ({ unblockMember: mocks.unblock }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    const base = ns
      .split(".")
      .reduce(
        (o: unknown, k) => (o as Record<string, unknown>)[k],
        viMessages,
      ) as Record<string, string>;
    return (k: string) => base[k] ?? k;
  },
}));
vi.mock("../account-card", () => ({
  ExchangeAccountCard: () => <div data-testid="account-card" />,
}));
vi.mock("@/components/notifications/notification-prefs-section", () => ({
  NotificationPrefsSection: (p: {
    scope: string;
    exchangeEnabled?: boolean;
  }) => (
    <div
      data-testid="prefs"
      data-scope={p.scope}
      data-exchange={String(!!p.exchangeEnabled)}
    />
  ),
}));
vi.mock("@/components/exchange/exchange-card", () => ({
  ExchangeCard: ({ event }: { event: { code: string } }) => (
    <div data-testid="card">{event.code}</div>
  ),
}));

const { default: MyExchangesPage } = await import("./page");
const { MyExchanges } = await import("./my-exchanges");

afterEach(cleanup);

const member = {
  id: 7,
  name: "Me",
  avatarUrl: null,
  avatarKey: null,
  signupIntent: "exchange",
};

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("/giao-luu/cua-toi page", () => {
  it("exchange account sees notification prefs with the exchange group on /giao-luu/cua-toi", async () => {
    mocks.viewer.current = { status: "ok", member, isGroupMember: false };
    mocks.mine.mockResolvedValue({
      registrations: [],
      hosting: [],
      blocks: [],
    });
    mocks.settings.mockResolvedValue({ notificationsEnabled: true });
    render(withIntl(await MyExchangesPage()));
    expect(screen.getByTestId("account-card")).toBeTruthy();
    const prefs = screen.getByTestId("prefs");
    expect(prefs.getAttribute("data-scope")).toBe("member");
    expect(prefs.getAttribute("data-exchange")).toBe("true");
  });

  it("hides the prefs card when notifications are off and sends guests to login", async () => {
    mocks.viewer.current = { status: "ok", member, isGroupMember: true };
    mocks.mine.mockResolvedValue({
      registrations: [],
      hosting: [],
      blocks: [],
    });
    mocks.settings.mockResolvedValue({ notificationsEnabled: false });
    render(withIntl(await MyExchangesPage()));
    expect(screen.queryByTestId("prefs")).toBeNull();
    expect(screen.queryByTestId("account-card")).toBeNull();
    cleanup();

    mocks.viewer.current = { status: "anonymous" };
    await expect(MyExchangesPage()).rejects.toThrow(
      "REDIRECT:/giao-luu/dang-nhap?next=%2Fgiao-luu%2Fcua-toi",
    );
  });
});

describe("MyExchanges", () => {
  const baseCard = {
    title: "T",
    startAt: "2099-06-01T12:00:00.000Z",
    endAt: "2099-06-01T14:00:00.000Z",
    status: "open",
    skillMin: null,
    skillMax: null,
    slotsTotal: 10,
    venue: { id: 1, name: "V", lat: 1, lng: 1, areaLabel: null },
    host: { name: "H", avatarUrl: null, avatarKey: null },
    distanceM: 0,
    fee: { kind: "fixed", male: 50000, female: 50000 },
    counts: {},
  };

  it("shows status, remaining and refund, and unblocks optimistically with rollback", async () => {
    mocks.unblock.mockResolvedValue({ error: "nope" });
    render(
      withIntl(
        <MyExchanges
          registrations={
            [
              {
                ...baseCard,
                code: "r1",
                myStatus: "approved",
                feeAmount: 60000,
                paid: false,
                waitlistPos: null,
                remaining: 60000,
                refundDue: 0,
              },
              {
                ...baseCard,
                code: "r2",
                myStatus: "waitlist",
                feeAmount: null,
                paid: false,
                waitlistPos: 3,
                remaining: 0,
                refundDue: 20000,
              },
            ] as never
          }
          hosting={[]}
          blocks={[{ id: 5, name: "Bad Guy" }]}
        />,
      ),
    );
    expect(screen.getByText("Đã được duyệt")).toBeTruthy();
    expect(screen.getByText(/Còn thiếu/)).toBeTruthy();
    expect(screen.getByText("Danh sách chờ, vị trí 3")).toBeTruthy();
    expect(screen.getByText(/Host cần hoàn/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chặn Bad Guy" }));
    // Lạc quan: dòng biến mất ngay, trước khi server trả lời.
    expect(screen.queryByText("Bad Guy")).toBeNull();
    expect(mocks.unblock).toHaveBeenCalledWith({ blockId: 5 });
    // Lỗi (cả lần thử lại): dòng quay lại và có toast.
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("nope"),
    );
    expect(await screen.findByText("Bad Guy")).toBeTruthy();
  });

  it("shows an empty state with a link to browse", () => {
    render(
      withIntl(<MyExchanges registrations={[]} hosting={[]} blocks={[]} />),
    );
    expect(
      screen
        .getByRole("link", { name: "Tìm buổi giao lưu" })
        .getAttribute("href"),
    ).toBe("/giao-luu");
  });
});
