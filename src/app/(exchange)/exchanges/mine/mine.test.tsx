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

describe("/exchanges/mine page", () => {
  it("exchange account sees notification prefs with the exchange group on /exchanges/mine", async () => {
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
      "REDIRECT:/exchanges/login?next=%2Fexchanges%2Fmine",
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

  it("shows the fee only for a chargeable status on an event that still runs", () => {
    const row = (code: string, myStatus: string, status = "locked") => ({
      ...baseCard,
      code,
      status,
      myStatus,
      feeAmount: 70000,
      paid: false,
      waitlistPos: null,
      remaining: 0,
      refundDue: 0,
    });
    render(
      withIntl(
        <MyExchanges
          registrations={
            [
              row("charged", "late_cancelled"),
              row("plain", "cancelled"),
              row("rejected", "rejected"),
              row("evcancel", "approved", "cancelled"),
            ] as never
          }
          hosting={[]}
          blocks={[]}
        />,
      ),
    );
    // Only the late canceller still carries the 70K fee.
    expect(screen.getAllByText(/^Phí /)).toHaveLength(1);
  });

  it("shows an empty state with a link to browse", () => {
    render(
      withIntl(<MyExchanges registrations={[]} hosting={[]} blocks={[]} />),
    );
    expect(
      screen
        .getByRole("link", { name: "Tìm buổi giao lưu" })
        .getAttribute("href"),
    ).toBe("/exchanges");
  });
  it("my exchanges shows the new comment badge only when newComments > 0", () => {
    const card = (code: string, newComments: number) => ({
      ...baseCard,
      code,
      newComments,
    });
    render(
      withIntl(
        <MyExchanges
          registrations={
            [
              {
                ...card("r1", 3),
                myStatus: "approved",
                feeAmount: null,
                paid: false,
                waitlistPos: null,
                remaining: 0,
                refundDue: 0,
              },
              {
                ...card("r2", 0),
                myStatus: "approved",
                feeAmount: null,
                paid: false,
                waitlistPos: null,
                remaining: 0,
                refundDue: 0,
              },
            ] as never
          }
          hosting={[card("h1", 1)] as never}
          blocks={[]}
        />,
      ),
    );
    const badges = screen.getAllByRole("link", { name: /bình luận mới/ });
    expect(badges.map((b) => b.textContent)).toEqual([
      "3 bình luận mới",
      "1 bình luận mới",
    ]);
    expect(badges[0].getAttribute("href")).toBe("/exchanges/r1#comments");
    expect(badges[1].getAttribute("href")).toBe("/exchanges/h1#comments");
  });

  it("my exchanges shows Chưa đánh giá only for todo and the profile link when myCode is set", () => {
    const reg = (code: string, feedback: "todo" | "done" | null) => ({
      ...baseCard,
      code,
      status: "done",
      myStatus: "approved",
      feeAmount: null,
      paid: false,
      waitlistPos: null,
      remaining: 0,
      refundDue: 0,
      newComments: 0,
      feedback,
    });
    render(
      withIntl(
        <MyExchanges
          registrations={
            [
              reg("todo1", "todo"),
              reg("done1", "done"),
              reg("none1", null),
            ] as never
          }
          hosting={[]}
          blocks={[]}
          myCode="mycode0001"
        />,
      ),
    );
    const todo = screen.getAllByRole("link", { name: /Chưa đánh giá/ });
    expect(todo).toHaveLength(1);
    expect(todo[0].getAttribute("href")).toBe("/exchanges/todo1?feedback=1");
    expect(
      screen
        .getByRole("link", { name: "Hồ sơ công khai của bạn" })
        .getAttribute("href"),
    ).toBe("/players/mycode0001");
    cleanup();

    render(
      withIntl(
        <MyExchanges
          registrations={[reg("done1", "done")] as never}
          hosting={[]}
          blocks={[]}
          myCode={null}
        />,
      ),
    );
    expect(screen.queryByRole("link", { name: /Chưa đánh giá/ })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Hồ sơ công khai của bạn" }),
    ).toBeNull();
  });
});
