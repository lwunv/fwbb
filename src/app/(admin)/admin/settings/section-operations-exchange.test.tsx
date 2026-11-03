// @vitest-environment jsdom
/**
 * Công tắc giao lưu nằm ở mục "Vận hành" và đi qua bản nháp chung như mọi ô
 * khác. Điều cần khoá: bấm Lưu khi chỉ sửa ô khác thì KHÔNG gửi exchangeEnabled
 * (không vô tình bật/tắt cờ), còn gạt công tắc thì gửi đúng giá trị mới.
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

function wrap(exchangeEnabled: boolean) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider
        settings={{ ...defaultSettings(), exchangeEnabled }}
      >
        <SectionOperations />
        <SettingsSaveBar />
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

const exchangeSwitch = () =>
  screen.getByRole("switch", {
    name: viMessages.adminSettings.exchangeEnabled,
  });

describe("công tắc giao lưu ở mục Vận hành", () => {
  it("hiện đúng giá trị server và nhắc đặt biến Zalo/Turnstile trước khi bật", () => {
    wrap(false);
    expect(exchangeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText(viMessages.adminSettings.exchangeEnabledHint),
    ).toBeTruthy();
    expect(viMessages.adminSettings.exchangeEnabledHint).toMatch(/Vercel/);
    expect(viMessages.adminSettings.exchangeEnabledHint).not.toMatch(/[—–]/);
  });

  it("lưu trang khi chỉ sửa tên nhóm thì KHÔNG gửi exchangeEnabled", async () => {
    wrap(true);
    expect(exchangeSwitch().getAttribute("aria-checked")).toBe("true");

    fireEvent.change(screen.getByDisplayValue("FWBB"), {
      target: { value: "FWBB Club" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    await waitFor(() => expect(updateSetting).toHaveBeenCalled());
    const keys = updateSetting.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(["appName"]);
  });

  it("gạt công tắc rồi lưu thì gửi exchangeEnabled = true", async () => {
    wrap(false);
    fireEvent.click(exchangeSwitch());
    fireEvent.click(screen.getByRole("button", { name: /Lưu/ }));

    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith("exchangeEnabled", true),
    );
  });
});
