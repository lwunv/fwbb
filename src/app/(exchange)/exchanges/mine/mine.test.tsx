// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const mocks = vi.hoisted(() => ({
  viewer: { current: {} as Record<string, unknown> },
  mine: vi.fn(),
  settings: vi.fn(),
  unblock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  referralState: vi.fn(),
  ensureCode: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/member-auth", () => ({
  getExchangeViewer: async () => mocks.viewer.current,
}));
vi.mock("@/actions/exchange-mine", () => ({ getMyExchanges: mocks.mine }));
vi.mock("@/actions/settings", () => ({ getSettings: mocks.settings }));
vi.mock("@/actions/exchange-host", () => ({ unblockMember: mocks.unblock }));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/actions/referrals", () => ({
  getMyReferralState: mocks.referralState,
  ensureMyPublicCode: mocks.ensureCode,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ refresh: mocks.refresh }),
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
beforeEach(() => {
  mocks.referralState.mockResolvedValue(null);
});

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

  it("a limited account sees the newcomer card; sharing calls ensureMyPublicCode then shares /players/{code}", async () => {
    const limited = {
      limited: true,
      eligible: false,
      used: 0,
      limit: 5,
      blockedDate: null,
    };
    mocks.ensureCode.mockResolvedValue({ code: "mycode0001" });
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const card = (myCode: string | null) =>
      withIntl(
        <MyExchanges
          registrations={[]}
          hosting={[]}
          blocks={[]}
          myCode={myCode}
          referral={limited}
        />,
      );

    // Chưa có mã: tạo mã ở server, làm mới trang, chưa chia sẻ (đã mất lượt
    // chạm của người dùng nên Safari/Zalo sẽ chặn) và bảo bấm lại.
    const { rerender } = render(card(null));
    expect(
      screen.getByText(
        "Tài khoản mới bị giới hạn: tối đa 2 đăng ký đang chờ, không dắt thêm người, 5 bình luận mỗi ngày. Nhờ người quen đã chơi từ 3 buổi giới thiệu để bỏ giới hạn.",
      ),
    ).toBeTruthy();
    const btn = () =>
      screen.getByRole("button", { name: "Chia sẻ hồ sơ của tôi" });
    expect(btn().className).toMatch(/min-h-11/);
    fireEvent.click(btn());
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.ensureCode).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Đã tạo link hồ sơ. Bấm chia sẻ lần nữa để gửi.",
    );

    // Sau khi làm mới đã có mã: chia sẻ ngay trong lúc chạm, không chờ server.
    rerender(card("mycode0001"));
    await vi.waitFor(() =>
      expect((btn() as HTMLButtonElement).disabled).toBe(false),
    );
    mocks.ensureCode.mockClear();
    fireEvent.click(btn());
    expect(share).toHaveBeenCalledTimes(1);
    expect(mocks.ensureCode).not.toHaveBeenCalled();
    const arg = (share.mock.calls[0] as unknown as [{ url: string }])[0];
    expect(arg.url).toBe(`${window.location.origin}/players/mycode0001`);

    // Không có Web Share: chép link ngay trong lúc chạm và báo.
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(btn());
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/players/mycode0001`,
    );
    expect(mocks.ensureCode).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Đã chép link hồ sơ"),
    );

    // Lỗi tạo mã: báo lỗi, không làm mới, không chia sẻ gì.
    rerender(card(null));
    mocks.refresh.mockClear();
    mocks.ensureCode.mockResolvedValueOnce({ error: "Không tạo được mã" });
    writeText.mockClear();
    fireEvent.click(btn());
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Không tạo được mã"),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    cleanup();

    // Người đã quen không thấy thẻ này.
    render(
      withIntl(
        <MyExchanges
          registrations={[]}
          hosting={[]}
          blocks={[]}
          referral={{ ...limited, limited: false }}
        />,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Chia sẻ hồ sơ của tôi" }),
    ).toBeNull();
  });
});

describe("/exchanges/mine referrals", () => {
  it("a referrer sees used/limit and the blocked date", async () => {
    mocks.viewer.current = { status: "ok", member, isGroupMember: true };
    mocks.mine.mockResolvedValue({
      registrations: [],
      hosting: [],
      blocks: [],
    });
    mocks.settings.mockResolvedValue({ notificationsEnabled: false });
    mocks.referralState.mockResolvedValue({
      eligible: true,
      usedThisMonth: 2,
      limit: 5,
      // 20:00 UTC ngày 14 là ngày 15 giờ Việt Nam.
      blockedUntil: "2026-12-14T20:00:00.000Z",
      limited: false,
    });
    render(withIntl(await MyExchangesPage()));
    expect(
      screen.getByText("Bạn đã giới thiệu 2/5 người trong tháng này"),
    ).toBeTruthy();
    expect(
      screen.getByText("Bạn tạm không giới thiệu được tới 15/12/2026"),
    ).toBeTruthy();
    expect(screen.queryByText(/Tài khoản mới bị giới hạn/)).toBeNull();
    cleanup();

    // Đủ điều kiện, không bị khoá: chỉ dòng đã dùng.
    mocks.referralState.mockResolvedValue({
      eligible: true,
      usedThisMonth: 0,
      limit: 5,
      blockedUntil: null,
      limited: false,
    });
    render(withIntl(await MyExchangesPage()));
    expect(
      screen.getByText("Bạn đã giới thiệu 0/5 người trong tháng này"),
    ).toBeTruthy();
    expect(screen.queryByText(/tạm không giới thiệu/)).toBeNull();
    cleanup();

    // Chưa đủ điều kiện, không giới hạn: không có thẻ giới thiệu nào.
    mocks.referralState.mockResolvedValue({
      eligible: false,
      usedThisMonth: 0,
      limit: 5,
      blockedUntil: null,
      limited: false,
    });
    render(withIntl(await MyExchangesPage()));
    expect(screen.queryByText(/người trong tháng này/)).toBeNull();
  });
});
