// @vitest-environment jsdom
/**
 * Panel "Mặc định khi tạo buổi" trên Dashboard.
 *
 * Thứ phải khoá chặt nhất là nó KHÔNG ghi thẳng xuống DB lúc gõ. Panel nằm
 * ngay trang đầu tiên admin mở, bấm nhầm một ngày trong lúc lướt mà nó lưu
 * luôn thì buổi kế tiếp tự tạo sai ngày và không ai biết. User đã chốt kiểu
 * nháp + nút Lưu cho trang Cài đặt (22/9/2026), panel này phải theo đúng vậy.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { defaultSettings } from "@/lib/settings-registry";

// Khai kiểu tham số để `updateSetting.mock.calls` đọc được khoá đã gửi.
const updateSetting =
  vi.fn<(key: string, value: unknown) => Promise<{ success: true }>>();
updateSetting.mockResolvedValue({ success: true });
vi.mock("@/actions/settings", () => ({
  updateSetting: (...args: unknown[]) =>
    updateSetting(...(args as Parameters<typeof updateSetting>)),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SessionDefaultsPanel } = await import("./session-defaults-panel");

afterEach(() => {
  cleanup();
  updateSetting.mockClear();
});

const COURTS = [{ id: 7, name: "Sân Bách Khoa", pricePerSession: 240000 }];
const BRANDS = [{ id: 3, name: "Hải Yến", pricePerTube: 180000 }];

function renderPanel(over: Partial<ReturnType<typeof defaultSettings>> = {}) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SessionDefaultsPanel
        settings={{ ...defaultSettings(), ...over }}
        courts={COURTS}
        brands={BRANDS}
      />
    </NextIntlClientProvider>,
  );
}

const saveButton = () => screen.getByRole("button", { name: /^Lưu$/ });
const day = (label: string) => screen.getByRole("button", { name: label });

describe("năm thứ admin chỉnh nhiều nhất đều có mặt", () => {
  it("hiện đủ ngày, giờ chơi, sân, cầu, sĩ số", () => {
    renderPanel();

    expect(screen.getByText("Ngày tự tạo buổi trong tuần")).toBeTruthy();
    expect(screen.getByText("Giờ bắt đầu")).toBeTruthy();
    expect(screen.getByText("Giờ kết thúc")).toBeTruthy();
    expect(screen.getByText("Sân mặc định")).toBeTruthy();
    expect(screen.getByText("Hãng cầu mặc định")).toBeTruthy();
    expect(screen.getByText("Số người tối đa")).toBeTruthy();
  });

  it("đánh dấu đúng những ngày đang bật", () => {
    renderPanel({ sessionDaysOfWeek: [2, 4] });

    expect(day("T3").getAttribute("aria-pressed")).toBe("true");
    expect(day("T5").getAttribute("aria-pressed")).toBe("true");
    expect(day("T2").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("nháp rồi mới lưu", () => {
  it("đổi ngày KHÔNG gửi gì lên server cho tới khi bấm Lưu", async () => {
    renderPanel({ sessionDaysOfWeek: [1, 3, 5] });

    fireEvent.click(day("T7"));

    expect(updateSetting).not.toHaveBeenCalled();
    expect(day("T7").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 thay đổi chưa lưu")).toBeTruthy();

    fireEvent.click(saveButton());

    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
    expect(updateSetting).toHaveBeenCalledWith(
      "sessionDaysOfWeek",
      [1, 3, 5, 6],
    );
  });

  it("chưa sửa gì thì nút Lưu mờ", () => {
    renderPanel();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();
  });

  it("Hoàn tác trả ô về đúng giá trị server, không gọi server", async () => {
    renderPanel({ sessionDaysOfWeek: [1] });

    fireEvent.click(day("T4"));
    expect(day("T4").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));

    expect(day("T4").getAttribute("aria-pressed")).toBe("false");
    expect(updateSetting).not.toHaveBeenCalled();
    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();
  });

  it("gửi mỗi khoá đã sửa một lần, không đụng khoá không sửa", async () => {
    renderPanel({ sessionDaysOfWeek: [1], defaultMaxPlayers: 16 });

    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "20" },
    });
    fireEvent.click(day("T4"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(2));
    const keys = updateSetting.mock.calls.map((c) => c[0]);
    expect(new Set(keys)).toEqual(
      new Set(["defaultMaxPlayers", "sessionDaysOfWeek"]),
    );
    expect(keys).not.toContain("defaultStartTime");
  });
});

describe("chặn giá trị registry sẽ từ chối", () => {
  it("không cho bỏ ngày cuối cùng", async () => {
    renderPanel({ sessionDaysOfWeek: [3] });

    fireEvent.click(day("T4"));

    expect(day("T4").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();
  });

  it("sĩ số 0 không vào được bản nháp", async () => {
    renderPanel({ defaultMaxPlayers: 16 });

    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "0" },
    });

    expect(screen.getByText("Chưa có thay đổi")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });
});
