// @vitest-environment jsdom
/**
 * Lựa chọn "% của nhóm nam" trên trang Cài đặt (yêu cầu 22/9/2026).
 *
 * Hai điều dễ hỏng nhất, và đều hỏng im lặng:
 * 1. Lựa chọn này lọt sang nhóm nam. Nhóm nam không có gốc nào để lấy phần
 *    trăm, chọn xong thì bộ tính tiền coi như chia đều — admin tưởng đã giảm
 *    giá mà thật ra không.
 * 2. Chọn xong mà `percent` không được ghi. Cấu hình lưu trước hôm nay không
 *    có field này, để trống thì bộ tính tiền hiểu là 100%, tức nữ vẫn trả
 *    bằng nam dù màn hình ghi đang tính theo phần trăm.
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
import type { GroupKey, GroupPolicy } from "@/lib/group-policy";

const settingsActions = vi.hoisted(() => ({
  updateSetting: vi.fn<(key: string, value: unknown) => Promise<unknown>>(
    async () => ({ success: true }),
  ),
}));
vi.mock("@/actions/settings", () => settingsActions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SectionMoney } = await import("./section-money");
const { SettingsDraftProvider } = await import("./settings-draft");
const { SettingsSaveBar } = await import("./settings-save-bar");

afterEach(() => {
  cleanup();
  settingsActions.updateSetting.mockClear();
});

/** Trang Cài đặt với công tắc giới tính ĐANG BẬT (nhóm nữ mới hiện ra). */
function renderSection() {
  const settings = { ...defaultSettings(), genderPricingEnabled: true };
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider settings={settings}>
        <SectionMoney />
        <SettingsSaveBar />
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

function openModeMenu(group: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^Cách tính: ${group}$`),
    }),
  );
}

/** groupPolicies của lần ghi gần nhất. */
function savedPolicies() {
  const calls = settingsActions.updateSetting.mock.calls.filter(
    (c) => c[0] === "groupPolicies",
  );
  return calls.at(-1)?.[1] as Record<GroupKey, GroupPolicy> | undefined;
}

describe("cách tính theo phần trăm trên trang Cài đặt", () => {
  it("nhóm NỮ có lựa chọn này", () => {
    renderSection();
    openModeMenu("Thành viên nữ");
    expect(screen.getByText("% của nhóm nam")).toBeTruthy();
  });

  it("nhóm NAM không có — chọn được là sai, vì không có gốc để lấy phần trăm", () => {
    renderSection();
    openModeMenu("Thành viên");
    expect(screen.queryByText("% của nhóm nam")).toBeNull();
  });

  it("chọn xong thì ô phần trăm hiện ra, điền sẵn 80", () => {
    renderSection();
    openModeMenu("Thành viên nữ");
    fireEvent.click(screen.getByText("% của nhóm nam"));

    const input = screen.getByLabelText(
      /^Phần trăm so với nhóm nam: Thành viên nữ$/,
    ) as HTMLInputElement;
    expect(input.value).toBe("80");
    // Ô số tiền phải biến mất: phần trăm và số tiền loại trừ nhau.
    expect(screen.queryByLabelText(/^Số tiền: Thành viên nữđ$/)).toBeNull();
  });

  it("nút − và + nhảy 5%, chặn ở 0 và 100 (user chốt 22/9/2026)", async () => {
    renderSection();
    openModeMenu("Thành viên nữ");
    fireEvent.click(screen.getByText("% của nhóm nam"));

    const input = screen.getByLabelText(
      /^Phần trăm so với nhóm nam: Thành viên nữ$/,
    ) as HTMLInputElement;
    const minus = screen.getByRole("button", { name: "Giảm 5" });
    const plus = screen.getByRole("button", { name: "Tăng 5" });

    // Bước nhảy đúng 5.
    fireEvent.click(minus);
    expect(input.value).toBe("75");
    fireEvent.click(plus);
    expect(input.value).toBe("80");

    // Chặn trên ở 100: bấm quá số lần cần thiết cũng không vượt.
    for (let i = 0; i < 10; i++) fireEvent.click(plus);
    expect(input.value).toBe("100");

    // Chặn dưới ở 0 — 0% là hợp lệ (nữ chơi miễn phí), không phải lỗi.
    for (let i = 0; i < 30; i++) fireEvent.click(minus);
    expect(input.value).toBe("0");
  });

  it("bấm Lưu: gửi lên đúng mode percent KÈM số phần trăm", async () => {
    renderSection();
    openModeMenu("Thành viên nữ");
    fireEvent.click(screen.getByText("% của nhóm nam"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(savedPolicies()).toBeTruthy());
    const sent = savedPolicies() as Record<GroupKey, GroupPolicy>;
    expect(sent.memberFemale.mode).toBe("percent");
    expect(sent.memberFemale.percent).toBe(80);
    // Năm nhóm còn lại không được đụng tới.
    expect(sent.member.mode).toBe("equal");
    expect(sent.guestAdmin.mode).toBe("floor");
  });

  it("sửa được số phần trăm, và giá trị sửa mới là giá trị được lưu", async () => {
    renderSection();
    openModeMenu("Thành viên nữ");
    fireEvent.click(screen.getByText("% của nhóm nam"));

    const input = screen.getByLabelText(
      /^Phần trăm so với nhóm nam: Thành viên nữ$/,
    );
    fireEvent.change(input, { target: { value: "65" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => expect(savedPolicies()).toBeTruthy());
    expect(
      (savedPolicies() as Record<GroupKey, GroupPolicy>).memberFemale.percent,
    ).toBe(65);
  });
});
