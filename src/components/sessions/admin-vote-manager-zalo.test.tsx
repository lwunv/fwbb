// @vitest-environment jsdom
/**
 * Nút soạn tin Zalo nhắc người chưa vote trong màn quản lý vote của admin: tin
 * nhắc TẤT CẢ người chưa vote nên ô tìm kiếm không được làm mất nút, và giờ
 * chơi lấy từ buổi thật chứ không lấy giờ mặc định.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  beforeEach,
} from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/votes", () => ({
  adminSetVote: vi.fn(),
  adminRemoveVote: vi.fn(),
  adminSetGuestCount: vi.fn(),
  adminSetPartner: vi.fn(),
}));
vi.mock("@/actions/sessions", () => ({
  setMemberMinDeductionExempt: vi.fn(),
}));
vi.mock("@/actions/finance", () => ({
  confirmPaymentByAdmin: vi.fn(),
  undoPaymentByAdmin: vi.fn(),
}));
vi.mock("@/actions/fund", () => ({
  recordContribution: vi.fn(),
  recordRefund: vi.fn(),
}));

const { AdminVoteManager } = await import("./admin-vote-manager");

const member = (id: number, name: string) => ({
  id,
  name,
  nickname: null,
  isActive: true,
  approvalStatus: "approved",
  avatarKey: null,
  avatarUrl: null,
  gender: "male",
});

// jsdom không có matchMedia, mà `useIsMobile` của component con gọi nó.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal("open", vi.fn());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderManager() {
  const an = member(1, "An");
  const binh = member(2, "Bình");
  const votes = [
    {
      id: 10,
      sessionId: 5,
      memberId: binh.id,
      willPlay: true,
      willDine: false,
      guestPlayCount: 0,
      guestDineCount: 0,
      guestPlayFemaleCount: 0,
      guestDineFemaleCount: 0,
      withPartner: false,
      member: binh,
    },
  ];
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <AdminVoteManager
        sessionId={5}
        votes={votes as never}
        members={[an, binh] as never}
        zaloShare={{
          sessionDate: "2026-11-06",
          startTime: "19:00",
          voteDeadline: null,
          zaloGroupUrl: "https://zalo.me/g/abc",
        }}
      />
    </NextIntlClientProvider>,
  );
}

const shareButton = () =>
  screen.queryByRole("button", { name: viMessages.notifications.share.label });

describe("AdminVoteManager Zalo reminder", () => {
  it("keeps the compose button when the search hides every unvoted member", () => {
    renderManager();
    expect(shareButton()).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Bình" },
    });
    expect(screen.queryByText("An")).toBeNull();
    expect(shareButton()).toBeTruthy();
  });

  it("uses the session's real start time and lists every unvoted member", () => {
    renderManager();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Bình" },
    });
    fireEvent.click(shareButton()!);
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0][0]);
    expect(text).toContain("lúc 19:00");
    expect(text).toContain("chưa vote: An.");
  });
});
