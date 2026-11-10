// @vitest-environment jsdom
/**
 * Sheet "Giới thiệu người này" (G2d Task 19, quyết định 39-44). Điều dễ hỏng
 * im lặng: gửi không kèm token Turnstile hoặc tự thử lại với token đã dùng,
 * chip "Được giới thiệu" không hiện ngay, hay lỗi mà chip vẫn còn (người xem
 * tưởng đã giới thiệu xong).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import {
  toPublicPlayerProfile,
  type Reputation,
} from "@/lib/reputation/public-profile";

const mocks = vi.hoisted(() => ({
  refer: vi.fn(),
  refresh: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  tok: { n: 0 },
  resetKeys: [] as number[],
}));
vi.mock("@/actions/referrals", () => ({ referMember: mocks.refer }));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: (p: {
    onToken: (t: string | null) => void;
    action: string;
    resetKey: number;
  }) => {
    mocks.resetKeys.push(p.resetKey);
    return (
      <button
        type="button"
        data-testid={`turnstile-${p.action}`}
        onClick={() => p.onToken(`tok-${++mocks.tok.n}`)}
      >
        ts
      </button>
    );
  },
}));

const { PlayerProfile } =
  await import("@/app/(exchange)/players/[code]/player-profile");

const CODE = "abcdefgh23";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tok.n = 0;
  mocks.resetKeys.length = 0;
});

const rep: Reputation = {
  member: {
    name: "Lê Thị Mới Vào",
    avatarUrl: null,
    avatarKey: null,
    skillLevel: "tb",
    approvalStatus: "pending",
    isActive: true,
  },
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
  host: null,
  referred: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderProfile() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <PlayerProfile
        profile={toPublicPlayerProfile(CODE, rep)}
        canReport
        referral={{ eligible: true, remaining: 3, limit: 5, blockedDate: null }}
      />
    </NextIntlClientProvider>,
  );
}

const chip = () =>
  within(screen.getByTestId("profile-header")).queryByText("Được giới thiệu");
const referBtn = () =>
  screen.queryByRole("button", { name: "Giới thiệu người này" });

async function openAndConfirm() {
  fireEvent.click(referBtn()!);
  const footer = await waitFor(() => {
    const el = document.querySelector(
      '[data-slot="responsive-sheet-footer"]',
    ) as HTMLElement | null;
    expect(el).toBeTruthy();
    return el!;
  });
  const confirm = within(footer).getByRole("button", {
    name: /Xác nhận giới thiệu|Đang kiểm tra bảo mật/,
  });
  // Chưa có token Turnstile thì chưa gửi được.
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(footer).getByTestId("turnstile-exchange_referral"));
  const ready = within(footer).getByRole("button", {
    name: "Xác nhận giới thiệu",
  });
  expect(ready.className).toMatch(/min-h-1[12]/);
  fireEvent.click(ready);
}

describe("ReferSheet", () => {
  it("refer sheet sends the code with a token, shows Được giới thiệu at once and rolls back with the server message", async () => {
    renderProfile();
    expect(chip()).toBeNull();
    fireEvent.click(referBtn()!);
    expect(
      await screen.findByText(
        "Bạn bảo đảm đây là người thật bạn quen. Họ được bỏ giới hạn tài khoản mới. Nếu họ vắng hoặc huỷ muộn từ 2 lần trong 30 ngày đầu, bạn tạm không giới thiệu được 30 ngày.",
      ),
    ).toBeTruthy();
    // Tên người được giới thiệu xuống dòng được, không bị cắt.
    expect(
      screen
        .getAllByText("Lê Thị Mới Vào")
        .some((el) => /break-words/.test(el.className)),
    ).toBe(true);
    cleanup();
    renderProfile();

    const first = deferred<{ success: true } | { error: string }>();
    mocks.refer.mockReturnValueOnce(first.promise);
    await openAndConfirm();

    expect(mocks.refer).toHaveBeenCalledWith({
      code: CODE,
      turnstileToken: "tok-1",
    });
    // Lạc quan: chip hiện ngay, nút giới thiệu biến mất, trước khi server trả lời.
    expect(chip()).toBeTruthy();
    expect(referBtn()).toBeNull();

    first.resolve({ error: "Người này đã được người khác giới thiệu." });
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Người này đã được người khác giới thiệu.",
      ),
    );
    // Hoàn lại: chip mất, nút quay lại; không tự thử lại với token đã dùng.
    await waitFor(() => expect(chip()).toBeNull());
    expect(referBtn()).toBeTruthy();
    expect(mocks.refer).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();

    // Lần sau: token mới (resetKey đã tăng), thành công thì làm mới trang.
    mocks.refer.mockResolvedValueOnce({ success: true });
    await openAndConfirm();
    expect(mocks.refer).toHaveBeenLastCalledWith({
      code: CODE,
      turnstileToken: "tok-2",
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(chip()).toBeTruthy();
    expect(Math.max(...mocks.resetKeys)).toBeGreaterThanOrEqual(1);
  });
});
