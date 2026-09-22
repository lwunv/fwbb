// @vitest-environment jsdom
/**
 * Trang Cài đặt chuyển sang có nút Lưu (22/9/2026): sửa gì cũng chỉ nằm trong
 * bản nháp, server chỉ nhận khi admin bấm Lưu.
 *
 * Hai điều đáng khoá lại:
 *
 * 1. Chưa bấm Lưu thì KHÔNG một request nào được bắn đi. Đó là cả lý do đổi
 *    cách làm: đây là trang quyết định chia tiền, admin phải xem lại được
 *    trước khi nó vào DB.
 *
 * 2. Bấm Lưu thì `groupPolicies` chỉ gửi MỘT lần, mang giá trị mới nhất. Bản
 *    cũ ghi ngay mỗi lần đổi, nên thao tác bình thường "đổi cách tính sang Cố
 *    định rồi gõ số tiền ngay sau" là hai lần ghi cả object nối nhau.
 *    `updateSetting` là upsert last-write-wins, không version check, nên lần
 *    ghi đầu về chậm hơn là đè lên bằng snapshot cũ, mất đúng lần sửa mới
 *    nhất, mà `.strict()` không bắt được vì cả hai payload đều hợp lệ. Gom vào
 *    một lần ghi thì kịch bản đó biến mất; test này giữ cho nó không quay lại.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

const settingsActions = vi.hoisted(() => ({
  // Khai kiểu tham số để `mock.calls` đọc được key/value; dùng generic thay
  // vì tham số giả, tránh biến không dùng.
  updateSetting: vi.fn<(key: string, value: unknown) => Promise<unknown>>(
    async () => ({ success: true }),
  ),
}));
vi.mock("@/actions/settings", () => settingsActions);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { SectionMoney } = await import("./section-money");
const { SettingsDraftProvider } = await import("./settings-draft");
const { SettingsSaveBar } = await import("./settings-save-bar");

afterEach(() => {
  cleanup();
  settingsActions.updateSetting.mockClear();
});

function renderSection() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider settings={defaultSettings()}>
        <SectionMoney />
        <SettingsSaveBar />
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

/** Payload của lần ghi `groupPolicies` gần nhất. */
function lastGroupPolicies() {
  const calls = settingsActions.updateSetting.mock.calls.filter(
    (c) => (c as unknown[])[0] === "groupPolicies",
  );
  return {
    count: calls.length,
    value: calls.at(-1)?.[1] as
      | Record<string, { mode: string; amount: number; capAtEqual: boolean }>
      | undefined,
  };
}

describe("SectionMoney — nháp rồi mới lưu", () => {
  it("sửa nhiều thứ nhưng chưa bấm Lưu: không gửi gì lên server", async () => {
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: /^Cách tính: Thành viên$/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cố định" }));
    const amountInput = screen.getByLabelText(/^Số tiền: Thành viênđ$/);
    fireEvent.change(amountInput, { target: { value: "50000" } });
    fireEvent.blur(amountInput);

    // Cho mọi microtask đang chờ chạy hết rồi mới kết luận "không gửi gì".
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settingsActions.updateSetting).not.toHaveBeenCalled();
    // Thanh Lưu phải báo có thay đổi, nếu không admin không biết còn gì chưa
    // lưu. (Nút Lưu luôn hiện, nên sự tồn tại của nó không chứng minh gì.)
    expect(screen.getByText("1 thay đổi chưa lưu")).toBeTruthy();
  });

  it("đổi cách tính rồi gõ số tiền, bấm Lưu: gửi MỘT lần, mang giá trị mới nhất", async () => {
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: /^Cách tính: Thành viên$/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cố định" }));
    const amountInput = screen.getByLabelText(/^Số tiền: Thành viênđ$/);
    fireEvent.change(amountInput, { target: { value: "50000" } });
    fireEvent.blur(amountInput);

    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(lastGroupPolicies().count).toBe(1));
    const { value } = lastGroupPolicies();
    expect(value?.member.amount).toBe(50000);
    expect(value?.member.mode).toBe("fixed");
  });

  it("bấm Hoàn tác: bản nháp bị bỏ, quay về giá trị server", async () => {
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: /^Cách tính: Thành viên$/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cố định" }));
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));

    // Không còn gì chưa lưu: nút Lưu mờ đi, nút Hoàn tác biến mất, và ô số
    // tiền (chỉ hiện ở mode khác "Chia đều") cũng ẩn theo.
    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Lưu" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Hoàn tác" })).toBeNull();
    expect(screen.queryByLabelText(/^Số tiền: Thành viênđ$/)).toBeNull();
    expect(settingsActions.updateSetting).not.toHaveBeenCalled();
  });
});
