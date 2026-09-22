// @vitest-environment jsdom
/**
 * Cảnh báo "còn N thành viên chưa khai giới tính" ở section chia tiền.
 *
 * Ba điều kiện hiện, và điều kiện đầu là quan trọng nhất: TẮT công tắc giới
 * tính thì tuyệt đối không nhắc gì. Tắt thì cột `members.gender` không ai đọc,
 * nhắc chỉ làm admin tưởng mình đang thiếu dữ liệu cho một tính năng họ chưa
 * bật.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

vi.mock("@/actions/settings", () => ({
  updateSetting: vi.fn(async () => ({ success: true })),
}));

const { SectionMoney } = await import("./section-money");
const { SettingsDraftProvider } = await import("./settings-draft");

afterEach(cleanup);

function renderSection(opts: { genderOn: boolean; unsetCount: number }) {
  const settings = {
    ...defaultSettings(),
    genderPricingEnabled: opts.genderOn,
  };
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider settings={settings}>
        <SectionMoney unsetGenderCount={opts.unsetCount} />
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

const warning = () => screen.queryByText(/chưa khai giới tính/);

describe("cảnh báo thành viên chưa khai giới tính", () => {
  it("công tắc TẮT: không nhắc gì, kể cả khi còn nhiều người chưa khai", () => {
    renderSection({ genderOn: false, unsetCount: 12 });
    expect(warning()).toBeNull();
  });

  it("công tắc BẬT nhưng ai cũng khai rồi: không nhắc", () => {
    renderSection({ genderOn: true, unsetCount: 0 });
    expect(warning()).toBeNull();
  });

  it("công tắc BẬT và còn người chưa khai: nhắc kèm ĐÚNG số", () => {
    renderSection({ genderOn: true, unsetCount: 7 });
    const w = warning();
    expect(w).not.toBeNull();
    expect(w?.textContent).toContain("7");
  });

  it("có đường dẫn sang trang Thành viên để khai luôn", () => {
    renderSection({ genderOn: true, unsetCount: 3 });
    const link = screen.getByRole("link", {
      name: /Khai giới tính ở trang Thành viên/,
    });
    expect(link.getAttribute("href")).toBe("/admin/members");
  });
});
