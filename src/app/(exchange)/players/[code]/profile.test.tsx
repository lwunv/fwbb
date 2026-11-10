// @vitest-environment jsdom
/**
 * Trang hồ sơ công khai /players/{code} (G2d Task 17, quyết định 15, 16).
 * Điều dễ hỏng im lặng: lộ thông tin của người xem (sđt, email) hay của người
 * chấm vào HTML, hiện nút báo cáo cho khách hoặc cho chính mình, hoặc trang
 * vẫn chạy (và bị lập chỉ mục) khi cờ giao lưu tắt.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import {
  toPublicPlayerProfile,
  type PublicPlayerProfile,
  type Reputation,
} from "@/lib/reputation/public-profile";

const mocks = vi.hoisted(() => ({
  getPublicProfile: vi.fn(),
  getExchangeViewer: vi.fn(),
  isExchangeEnabled: vi.fn(),
  getMyReferralState: vi.fn(),
  referMember: vi.fn(),
}));

vi.mock("@/lib/reputation/profile-read", () => ({
  getPublicProfile: mocks.getPublicProfile,
}));
vi.mock("@/lib/member-auth", () => ({
  getExchangeViewer: mocks.getExchangeViewer,
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: mocks.isExchangeEnabled,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/actions/referrals", () => ({
  getMyReferralState: mocks.getMyReferralState,
  referMember: mocks.referMember,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));
// Sheet báo cáo thật cần Turnstile và server action; ở đây chỉ cần biết nó
// mở với đúng đối tượng.
vi.mock("@/components/exchange/report-sheet", () => ({
  ReportSheet: (p: { open: boolean; target: unknown }) =>
    p.open ? (
      <div data-testid="report-sheet">{JSON.stringify(p.target)}</div>
    ) : null,
}));

import PlayerProfilePage from "./page";
import PlayersLayout, { metadata } from "../layout";

const CODE = "abcdefgh23";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isExchangeEnabled.mockResolvedValue(true);
  mocks.getExchangeViewer.mockResolvedValue({ status: "anonymous" });
  mocks.getMyReferralState.mockResolvedValue(null);
});

function rep(over: Partial<Reputation> = {}): Reputation {
  return {
    member: {
      name: "Nguyễn Văn Minh Có Một Cái Tên Rất Dài",
      avatarUrl: null,
      avatarKey: null,
      skillLevel: "tb",
      approvalStatus: "pending",
      isActive: true,
    },
    attendance: {
      attended: 4,
      approvedPast: 5,
      lateCancels: 1,
      noShows: 0,
      charged: 2,
      paidOnTime: 2,
      isNew: true,
    },
    peer: {
      raters: 5,
      playAgain: 3,
      tags: [{ tag: "on_time", count: 2 }],
      skill: { level: "tby", raters: 4 },
    },
    host: null,
    referred: false,
    ...over,
  };
}

const profile = (over: Partial<Reputation> = {}): PublicPlayerProfile =>
  toPublicPlayerProfile(CODE, rep(over));

async function renderPage(p: PublicPlayerProfile | null) {
  mocks.getPublicProfile.mockResolvedValue(p);
  const ui: ReactNode = await PlayerProfilePage({
    params: Promise.resolve({ code: CODE }),
  });
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function signedIn(publicCode: string | null, extra: object = {}) {
  mocks.getExchangeViewer.mockResolvedValue({
    status: "ok",
    user: { memberId: 9, externalId: "ext-9" },
    member: { id: 9, name: "Viewer", publicCode, ...extra },
    isGroupMember: false,
  });
}

describe("player profile page", () => {
  it("profile shows the name, Mới for a new account, the self skill, and the peer part only with peer.skill", async () => {
    await renderPage(profile());
    const name = screen.getByRole("heading", { level: 1 });
    expect(name.textContent).toBe("Nguyễn Văn Minh Có Một Cái Tên Rất Dài");
    expect(name.className).toMatch(/break-words/);
    expect(screen.getByText("Mới")).toBeTruthy();
    expect(screen.queryByText("Được giới thiệu")).toBeNull();
    expect(
      screen.getByText("Tự khai: TB · Người chơi cùng đánh giá: TBY (4 lượt)"),
    ).toBeTruthy();
    cleanup();

    await renderPage(
      profile({
        peer: { raters: 5, playAgain: 3, tags: [], skill: null },
        referred: true,
        attendance: { ...rep().attendance, isNew: false },
      }),
    );
    expect(screen.getByText("Tự khai: TB")).toBeTruthy();
    expect(screen.queryByText(/Người chơi cùng đánh giá/)).toBeNull();
    expect(screen.queryByText("Mới")).toBeNull();
    expect(screen.getByText("Được giới thiệu")).toBeTruthy();
    cleanup();

    await renderPage(
      profile({
        member: { ...rep().member, skillLevel: null },
        peer: { raters: 5, playAgain: 3, tags: [], skill: null },
      }),
    );
    expect(screen.getByText("Tự khai: chưa khai")).toBeTruthy();
  });

  it("unknown code or hidden profile is a 404", async () => {
    await expect(renderPage(null)).rejects.toThrow("notFound");
    expect(mocks.getPublicProfile).toHaveBeenCalledWith(CODE);
  });

  it("unknown code is a 404 and never reads the viewer", async () => {
    // Bot dò mã không được tốn một lần đọc DB không cache cho người xem.
    await expect(renderPage(null)).rejects.toThrow("notFound");
    expect(mocks.getExchangeViewer).not.toHaveBeenCalled();
  });

  it("host block only for someone who hosted", async () => {
    await renderPage(profile());
    expect(screen.queryByText("Khi làm host")).toBeNull();
    cleanup();

    await renderPage(
      profile({
        host: {
          organized: 3,
          cancelled: 0,
          cancelPct: 0,
          raters: 4,
          asDescribedPct: 90,
          feeAsPromisedPct: 100,
        },
      }),
    );
    expect(screen.getByText("Khi làm host")).toBeTruthy();
    expect(screen.getByText("Đúng mô tả")).toBeTruthy();
  });

  it("report button only for a signed-in viewer who is not that person", async () => {
    // Khách: không nút.
    await renderPage(profile());
    expect(screen.queryByRole("button", { name: "Báo cáo" })).toBeNull();
    cleanup();

    // Tài khoản bị khoá: không nút.
    mocks.getExchangeViewer.mockResolvedValue({ status: "blocked" });
    await renderPage(profile());
    expect(screen.queryByRole("button", { name: "Báo cáo" })).toBeNull();
    cleanup();

    // Chính mình: không nút.
    signedIn(CODE);
    await renderPage(profile());
    expect(screen.queryByRole("button", { name: "Báo cáo" })).toBeNull();
    cleanup();

    // Người khác (kể cả chưa có mã hồ sơ): có nút, mở sheet báo cáo người chơi.
    signedIn(null);
    await renderPage(profile());
    const btn = screen.getByRole("button", { name: "Báo cáo" });
    expect(btn.className).toMatch(/min-h-11/);
    expect(screen.queryByTestId("report-sheet")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("report-sheet").textContent).toBe(
      JSON.stringify({ type: "player", code: CODE }),
    );
  });

  it("rendered HTML has no rater name, event title or code, phone or email", async () => {
    // Reputation rò rỉ (trường thừa ở mọi tầng) và người xem có sđt, email.
    const leaky = {
      ...rep(),
      member: {
        ...rep().member,
        id: 4242,
        phone: "0912345678",
        email: "minh@example.com",
      },
      peer: {
        ...rep().peer,
        raterNames: ["Trần Người Chấm"],
        tags: [
          { tag: "on_time" as const, count: 2, fromName: "Trần Người Chấm" },
        ],
      },
      events: [{ code: "evtcode999", title: "Giao lưu Cầu Giấy tối thứ 7" }],
    } as unknown as Reputation;
    signedIn("zzzzzzzz22", {
      phone: "0987654321",
      email: "viewer@example.com",
    });
    const { container } = await renderPage(toPublicPlayerProfile(CODE, leaky));
    const html = container.innerHTML;
    for (const secret of [
      "Trần Người Chấm",
      "evtcode999",
      "Giao lưu Cầu Giấy",
      "0912345678",
      "0987654321",
      "minh@example.com",
      "viewer@example.com",
      "4242",
      "zzzzzzzz22",
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(html).not.toMatch(/@/);
  });

  it("empty profile shows the find-exchanges button", async () => {
    await renderPage(
      profile({
        attendance: {
          attended: 0,
          approvedPast: 0,
          lateCancels: 0,
          noShows: 0,
          charged: 0,
          paidOnTime: 0,
          isNew: true,
        },
        peer: { raters: null, playAgain: null, tags: [], skill: null },
      }),
    );
    const empty = screen.getByText("Chưa có buổi nào được điểm danh.");
    expect(empty).toBeTruthy();
    const link = screen.getByRole("link", { name: "Tìm buổi giao lưu" });
    expect(link.getAttribute("href")).toBe("/exchanges");
    expect(link.className).toMatch(/min-h-11/);
    expect(screen.queryByText("Tỉ lệ đến")).toBeNull();
    cleanup();

    await renderPage(profile());
    expect(screen.queryByText("Chưa có buổi nào được điểm danh.")).toBeNull();
  });

  it("values text-base, buttons min-h-11", async () => {
    signedIn(null);
    await renderPage(
      profile({
        host: {
          organized: 3,
          cancelled: 1,
          cancelPct: 25,
          raters: 4,
          asDescribedPct: 90,
          feeAsPromisedPct: 100,
        },
      }),
    );
    for (const v of ["4 buổi", "80%", "3 lượt", "100%", "90%"]) {
      for (const el of screen.getAllByText(v)) {
        expect(el.className, v).toMatch(/text-base/);
      }
    }
    for (const label of ["Đã đến", "Muốn chơi lại cùng", "Đã tổ chức"]) {
      expect(screen.getByText(label).className, label).toMatch(
        /text-sm|text-base/,
      );
    }
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toMatch(/min-h-11/);
    }
    // Không có chữ nào nhỏ hơn 14px trên trang.
    expect(document.body.innerHTML).not.toMatch(/text-xs/);
    const card = screen.getByTestId("profile-header");
    expect(within(card).getByText("Mới")).toBeTruthy();
  });

  it("refer button only for an eligible signed-in viewer on a new unreferred profile, never your own", async () => {
    const state = {
      eligible: true,
      usedThisMonth: 2,
      limit: 5,
      blockedUntil: null as string | null,
      limited: false,
    };
    mocks.getMyReferralState.mockResolvedValue(state);
    const referBtn = () =>
      screen.queryByRole("button", { name: "Giới thiệu người này" });

    // Khách và chính mình: không nút, không tốn lần đọc trạng thái giới thiệu.
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    cleanup();
    signedIn(CODE);
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    expect(mocks.getMyReferralState).not.toHaveBeenCalled();
    cleanup();

    // Hồ sơ đã được giới thiệu, hoặc không còn là nick mới: không hỏi luôn.
    signedIn(null);
    await renderPage(profile({ referred: true }));
    expect(referBtn()).toBeNull();
    cleanup();
    await renderPage(
      profile({ attendance: { ...rep().attendance, isNew: false } }),
    );
    expect(referBtn()).toBeNull();
    expect(mocks.getMyReferralState).not.toHaveBeenCalled();
    cleanup();

    // Người khác, đủ điều kiện, còn lượt: có nút 44px và số lượt còn lại.
    await renderPage(profile());
    expect(mocks.getMyReferralState).toHaveBeenCalledTimes(1);
    expect(referBtn()!.className).toMatch(/min-h-11/);
    expect(screen.getByText("Bạn còn 3 lượt tháng này")).toBeTruthy();
    cleanup();

    // Không được giới thiệu thì nói rõ vì sao, không có nút.
    mocks.getMyReferralState.mockResolvedValue({ ...state, eligible: false });
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    expect(screen.getByText(/khi đã đến từ 3 buổi/)).toBeTruthy();
    cleanup();

    mocks.getMyReferralState.mockResolvedValue({ ...state, usedThisMonth: 5 });
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    expect(
      screen.getByText("Bạn đã dùng hết 5 lượt giới thiệu tháng này."),
    ).toBeTruthy();
    cleanup();

    // 20:00 UTC ngày 14 là 03:00 ngày 15 giờ Việt Nam.
    mocks.getMyReferralState.mockResolvedValue({
      ...state,
      blockedUntil: "2026-12-14T20:00:00.000Z",
    });
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    expect(
      screen.getByText("Bạn tạm không giới thiệu được tới 15/12/2026"),
    ).toBeTruthy();
    cleanup();

    // Cờ tắt hoặc phiên hết hạn giữa chừng: action trả null, không hiện gì.
    mocks.getMyReferralState.mockResolvedValue(null);
    await renderPage(profile());
    expect(referBtn()).toBeNull();
    expect(screen.queryByText(/giới thiệu/i)).toBeNull();
  });

  it("the profile chip never names the referrer", async () => {
    const leaky = {
      ...rep(),
      referred: true,
      referrer: { name: "Phạm Người Giới Thiệu", code: "refcode001", id: 77 },
      referrerName: "Phạm Người Giới Thiệu",
    } as unknown as Reputation;
    signedIn("zzzzzzzz22");
    const { container } = await renderPage(toPublicPlayerProfile(CODE, leaky));
    const card = screen.getByTestId("profile-header");
    expect(within(card).getByText("Được giới thiệu").textContent).toBe(
      "Được giới thiệu",
    );
    const html = container.innerHTML;
    for (const secret of ["Phạm Người Giới Thiệu", "refcode001"]) {
      expect(html, secret).not.toContain(secret);
    }
    expect(mocks.getMyReferralState).not.toHaveBeenCalled();
  });
});

describe("players layout", () => {
  it("layout returns 404 when the flag is off and sets robots noindex", async () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });

    mocks.isExchangeEnabled.mockResolvedValue(false);
    await expect(PlayersLayout({ children: <p>CHILD</p> })).rejects.toThrow(
      "notFound",
    );

    mocks.isExchangeEnabled.mockResolvedValue(true);
    const out = await PlayersLayout({ children: <p>CHILD</p> });
    render(<>{out}</>);
    expect(screen.getByText("CHILD")).toBeTruthy();
  });
});
