// @vitest-environment jsdom
/**
 * Ba ô thông báo ở mục "Vận hành" đi qua bản nháp chung: chỉ gửi khoá nào thật
 * sự bị sửa, link không phải zalo.me không bao giờ vào bản nháp, và ô số giờ
 * được kéo về khoảng hợp lệ lúc rời ô.
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
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

const updateSetting = vi.fn<(key: string, value: unknown) => Promise<unknown>>(
  async () => ({ success: true }),
);
vi.mock("@/actions/settings", () => ({
  updateSetting: (key: string, value: unknown) => updateSetting(key, value),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SectionOperations } = await import("./section-operations");
const { SettingsSaveBar } = await import("./settings-save-bar");
const { SettingsDraftProvider } =
  await import("@/components/settings/settings-draft");

beforeEach(() => updateSetting.mockClear());
afterEach(cleanup);

function wrap() {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider settings={defaultSettings()}>
        <SectionOperations />
        <SettingsSaveBar />
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

const m = viMessages.adminSettings;
const saveButton = () => screen.getByRole("button", { name: "Lưu" });

describe("cài đặt thông báo ở mục Vận hành", () => {
  it("gạt công tắc thông báo chỉ gửi notificationsEnabled", async () => {
    wrap();
    const sw = screen.getByRole("switch", { name: m.notificationsEnabled });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
    expect(updateSetting).toHaveBeenCalledWith("notificationsEnabled", true);
  });

  it("lưu link nhóm Zalo hợp lệ và số giờ nhắc chốt sân", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(m.zaloGroupUrl), {
      target: { value: "https://zalo.me/g/abc" },
    });
    fireEvent.change(screen.getByLabelText(m.courtLockHoursBefore), {
      target: { value: "12" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(2));
    expect(updateSetting).toHaveBeenCalledWith(
      "zaloGroupUrl",
      "https://zalo.me/g/abc",
    );
    expect(updateSetting).toHaveBeenCalledWith("courtLockHoursBefore", 12);
  });

  it("link không phải zalo.me báo lỗi tại ô và không vào bản nháp; giờ ngoài 1-72 được kéo về 72", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(m.zaloGroupUrl), {
      target: { value: "https://example.com/x" },
    });
    expect(screen.getByText(m.zaloGroupUrlInvalid)).toBeTruthy();
    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();

    const hours = screen.getByLabelText(m.courtLockHoursBefore);
    fireEvent.change(hours, { target: { value: "500" } });
    fireEvent.blur(hours);
    expect((hours as HTMLInputElement).value).toBe("72");
  });

  it("bấm Hoàn tác thì bỏ chữ link Zalo sai, ô hiện lại giá trị thật", () => {
    wrap();
    fireEvent.click(
      screen.getByRole("switch", { name: m.notificationsEnabled }),
    );
    const zalo = screen.getByLabelText(m.zaloGroupUrl) as HTMLInputElement;
    fireEvent.change(zalo, { target: { value: "https://example.com/x" } });
    expect(screen.getByText(m.zaloGroupUrlInvalid)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(screen.queryByText(m.zaloGroupUrlInvalid)).toBeNull();
    expect(zalo.value).toBe("");
  });

  it("lưu xong thì bỏ chữ link Zalo sai", async () => {
    wrap();
    fireEvent.click(
      screen.getByRole("switch", { name: m.notificationsEnabled }),
    );
    fireEvent.change(screen.getByLabelText(m.zaloGroupUrl), {
      target: { value: "https://example.com/x" },
    });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.queryByText(m.zaloGroupUrlInvalid)).toBeNull(),
    );
    expect(updateSetting).toHaveBeenCalledTimes(1);
    expect(updateSetting).toHaveBeenCalledWith("notificationsEnabled", true);
  });

  it("gõ link sai sau khi đã có link đúng trong nháp vẫn giữ báo lỗi", () => {
    wrap();
    const zalo = screen.getByLabelText(m.zaloGroupUrl);
    fireEvent.change(zalo, { target: { value: "https://zalo.me/g/abc" } });
    fireEvent.change(zalo, { target: { value: "https://example.com/y" } });
    expect(screen.getByText(m.zaloGroupUrlInvalid)).toBeTruthy();
  });
});
