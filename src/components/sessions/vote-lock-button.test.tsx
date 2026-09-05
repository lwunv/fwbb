// @vitest-environment jsdom
/**
 * Nút khóa/mở vote là một TOGGLE. Test này chốt đúng ba điều admin nhìn thấy:
 * nhãn nút đổi theo trạng thái hạn vote, mỗi nhãn gọi đúng action, và nhãn
 * flip NGAY khi bấm (optimistic) rồi rollback nếu server báo lỗi. Render với
 * messages vi.json thật (không mock i18n) nên thiếu key dịch là test đỏ.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { nowDeadlineVN } from "@/lib/vote-deadline";

type ActionResult = { success?: boolean; error?: string };

const actions = vi.hoisted(() => ({
  lockVoteNow: vi.fn(
    async (): Promise<{ success?: boolean; error?: string }> => ({
      success: true,
    }),
  ),
  setVoteDeadline: vi.fn(
    async (): Promise<{ success?: boolean; error?: string }> => ({
      success: true,
    }),
  ),
}));
vi.mock("@/actions/sessions", () => actions);

// fireAction chỉ là lớp bọc retry/toast; ở đây giả lập đúng contract tối thiểu:
// chạy thunk, kết quả có `error` (hoặc throw) thì gọi rollback. Nhờ vậy test
// được cả chiều optimistic-flip lẫn chiều rollback.
vi.mock("@/lib/optimistic-action", () => ({
  fireAction: (
    run: () => Promise<ActionResult>,
    rollback?: () => void,
  ): void => {
    void run()
      .then((r) => {
        if (r && typeof r === "object" && "error" in r && r.error) {
          rollback?.();
        }
      })
      .catch(() => rollback?.());
  },
}));

const { VoteLockButton } = await import("./vote-lock-button");

afterEach(() => {
  cleanup();
  actions.lockVoteNow.mockClear();
  actions.setVoteDeadline.mockClear();
});

// Hạn vote lưu theo giờ TƯỜNG của VN, nên phải sinh bằng nowDeadlineVN (pin
// Asia/Ho_Chi_Minh). Dùng formatLocalDeadline sẽ ra giờ theo timezone máy chạy
// test, và test đổi kết quả khi CI không ở +07:00.
const future = () => nowDeadlineVN(new Date(Date.now() + 3_600_000));
const past = () => nowDeadlineVN(new Date(Date.now() - 3_600_000));

function renderButton(deadline: string | null) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VoteLockButton sessionId={7} deadline={deadline} />
    </NextIntlClientProvider>,
  );
}

describe("VoteLockButton — toggle khóa/mở vote", () => {
  it("vote đang mở (hạn ở tương lai) → nút 'Khóa vote', bấm gọi lockVoteNow", () => {
    renderButton(future());
    const btn = screen.getByRole("button", { name: "Khóa vote" });
    fireEvent.click(btn);
    expect(actions.lockVoteNow).toHaveBeenCalledWith(7);
    expect(actions.setVoteDeadline).not.toHaveBeenCalled();
  });

  it("chưa đặt hạn (null) → vẫn là 'Khóa vote' vì vote đang mở vô hạn", () => {
    renderButton(null);
    // getByRole ném lỗi nếu không thấy, nên chỉ cần khẳng định nó trả về node
    // (repo chưa nạp @testing-library/jest-dom nên không dùng toBeInTheDocument).
    expect(screen.getByRole("button", { name: "Khóa vote" })).toBeTruthy();
  });

  it("vote đã đóng (hạn đã qua) → nút 'Mở vote', bấm xóa hạn để mở lại", () => {
    renderButton(past());
    const btn = screen.getByRole("button", { name: "Mở vote" });
    fireEvent.click(btn);
    expect(actions.setVoteDeadline).toHaveBeenCalledWith(7, null);
    expect(actions.lockVoteNow).not.toHaveBeenCalled();
  });

  it("bấm 'Khóa vote' → nhãn flip 'Mở vote' NGAY, không chờ server (optimistic)", () => {
    renderButton(future());
    fireEvent.click(screen.getByRole("button", { name: "Khóa vote" }));
    // Prop deadline chưa hề đổi (server chưa trả lời) nhưng nhãn đã phải flip,
    // để cú bấm thứ hai không chạy nhầm chiều ngược trên mạng chậm.
    expect(screen.getByRole("button", { name: "Mở vote" })).toBeTruthy();
  });

  it("server báo lỗi → nhãn rollback về theo prop", async () => {
    actions.lockVoteNow.mockResolvedValueOnce({ error: "not editable" });
    renderButton(future());
    fireEvent.click(screen.getByRole("button", { name: "Khóa vote" }));
    // Flip optimistic trước...
    expect(screen.getByRole("button", { name: "Mở vote" })).toBeTruthy();
    // ...rồi rollback khi action trả error.
    expect(
      await screen.findByRole("button", { name: "Khóa vote" }),
    ).toBeTruthy();
  });
});

describe("VoteLockButton — hạn vote qua khi trang đang mở", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("nhãn tự đổi sang 'Mở vote' khi hết hạn, không cần reload", async () => {
    vi.useFakeTimers();
    // Hạn còn 2 giây: nút vẫn ở chiều khóa.
    renderButton(nowDeadlineVN(new Date(Date.now() + 2_000)));
    expect(screen.getByRole("button", { name: "Khóa vote" })).toBeTruthy();

    // Đây là việc của setInterval trong component: qua hạn thì tự flip.
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("button", { name: "Mở vote" })).toBeTruthy();
  });
});
