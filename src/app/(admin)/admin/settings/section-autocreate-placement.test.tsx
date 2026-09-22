// @vitest-environment jsdom
/**
 * Công tắc "Tự động tạo buổi" phải nằm ở mục "Mặc định cho buổi mới", cùng chỗ
 * với bộ chọn ngày mà nó điều khiển.
 *
 * Trước 22/9/2026 nó nằm ở mục "Vận hành", cách xa "Ngày tự tạo buổi trong
 * tuần" cả hai section. Bật công tắc rồi mà không hiểu vì sao phải kéo xuống
 * chỗ khác chọn ngày là lỗi sắp xếp, không phải lỗi người dùng. Bài này khoá
 * cả hai chiều: có ở section đúng, và KHÔNG còn ở section cũ.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

vi.mock("@/actions/settings", () => ({
  updateSetting: vi.fn(async () => ({ success: true })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SectionSessionDefaults } = await import("./section-session-defaults");
const { SectionOperations } = await import("./section-operations");
const { SettingsDraftProvider } = await import("./settings-draft");

afterEach(cleanup);

function wrap(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SettingsDraftProvider settings={defaultSettings()}>
        {children}
      </SettingsDraftProvider>
    </NextIntlClientProvider>,
  );
}

const autoSwitch = () =>
  screen.queryByRole("switch", { name: "Tự động tạo buổi" });

describe("chỗ đứng của công tắc tự động tạo buổi", () => {
  it("nằm trong mục Mặc định cho buổi mới, cùng chỗ với bộ chọn ngày", () => {
    wrap(<SectionSessionDefaults courts={[]} brands={[]} />);

    expect(autoSwitch()).not.toBeNull();
    // Bộ chọn ngày phải ở cùng section — đó là lý do công tắc chuyển về đây.
    expect(screen.getByText("Ngày tự tạo buổi trong tuần")).toBeTruthy();
  });

  it("KHÔNG còn nằm ở mục Vận hành", () => {
    wrap(<SectionOperations />);

    expect(autoSwitch()).toBeNull();
    // Section vẫn render bình thường, không phải nó rỗng nên mới không thấy.
    expect(screen.getByText("Tài khoản nhận tiền")).toBeTruthy();
  });

  it("mô tả không nhắc tên công cụ kỹ thuật", () => {
    wrap(<SectionSessionDefaults courts={[]} brands={[]} />);

    // "Cron" là tên một thứ chạy ngầm, admin không cần biết và cũng không
    // đoán ra nghĩa. Mô tả phải nói nó LÀM GÌ.
    const hint = screen.getByText(/tự tạo buổi vote/i);
    expect(hint.textContent?.toLowerCase()).not.toContain("cron");
  });
});
