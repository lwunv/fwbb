// @vitest-environment jsdom
/**
 * Khối chọn trình độ ở trang /me.
 *
 * Điều dễ hỏng nhất không phải chuyện hiện ra, mà là chuyện bấm lại mức đang
 * chọn: nó phải GỬI chuỗi rỗng để bỏ khai, chứ không gửi lại chính mức đó.
 * Nếu sai, member không có cách nào gỡ lựa chọn và cũng chẳng có thông báo gì.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { SKILL_LEVELS, SKILL_BADGE_CLASS } from "@/lib/skill-level";

const actions = vi.hoisted(() => ({
  updateMySkillLevel: vi.fn<(raw: string) => Promise<unknown>>(async () => ({
    success: true,
  })),
}));
vi.mock("@/actions/members", () => actions);
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const { SkillLevelSection } = await import("./skill-level-section");

afterEach(() => {
  cleanup();
  actions.updateMySkillLevel.mockClear();
  actions.updateMySkillLevel.mockImplementation(async () => ({
    success: true,
  }));
  toasts.error.mockClear();
});

function renderSection(
  current: "tapChoi" | "yeu" | "tby" | "tb" | "tbk" | null,
) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SkillLevelSection current={current} />
    </NextIntlClientProvider>,
  );
}

const badge = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) });

/** Khối gập lại mặc định; mở ra mới thấy năm mức. */
function expand() {
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

describe("gập mở khối", () => {
  it("mặc định GẬP: không chiếm chỗ, chưa thấy mức nào", () => {
    renderSection("tb");
    expect(
      screen.queryByText("Thắng do Tao Bao, thua do Thằng Bạn"),
    ).toBeNull();
    expect(screen.queryByText("Tập chơi")).toBeNull();
  });

  it("gập lại vẫn thấy mức đang khai ngay trên thanh tiêu đề", () => {
    renderSection("tby");
    // Không mở ra mà vẫn biết mình đang khai gì.
    expect(screen.getByText("TBY")).toBeTruthy();
  });

  it("chưa khai thì thanh tiêu đề ghi rõ là chưa khai", () => {
    renderSection(null);
    expect(screen.getByText("Chưa khai")).toBeTruthy();
  });

  it("bấm tiêu đề thì mở ra, bấm lần nữa thì gập lại", () => {
    renderSection(null);
    expand();
    expect(screen.getByText("Yếu nhưng hay ra gió")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByText("Yếu nhưng hay ra gió")).toBeNull();
  });
});

describe("chọn trình độ", () => {
  it("hiện đủ năm mức, kèm câu mô tả", () => {
    renderSection(null);
    expand();
    expect(screen.getByText("Tập chơi")).toBeTruthy();
    expect(screen.getByText("Yếu")).toBeTruthy();
    expect(screen.getByText("TBY")).toBeTruthy();
    expect(screen.getByText("TB")).toBeTruthy();
    expect(screen.getByText("TBK")).toBeTruthy();
    expect(
      screen.getByText("Thắng do Tao Bao, thua do Thằng Bạn"),
    ).toBeTruthy();
  });

  it("mỗi mức mang màu riêng của nó", () => {
    renderSection(null);
    expand();
    for (const level of SKILL_LEVELS) {
      const el = screen
        .getByText(viMessages.me.skillShort[level])
        .closest("button");
      // Lấy token đầu của lớp màu là đủ để phân biệt gam màu.
      const token = SKILL_BADGE_CLASS[level].split(" ")[0];
      expect(el?.className, level).toContain(token);
    }
  });

  it("chưa khai thì không mức nào được đánh dấu đang chọn", () => {
    renderSection(null);
    expand();
    for (const level of SKILL_LEVELS) {
      const el = screen
        .getByText(viMessages.me.skillShort[level])
        .closest("button");
      expect(el?.getAttribute("aria-pressed"), level).toBe("false");
    }
  });

  it("bấm một mức: đánh dấu ngay và gửi đúng mức đó lên server", () => {
    renderSection(null);
    expand();
    // Khớp theo CÂU MÔ TẢ: sau khi chọn, thanh tiêu đề cũng hiện tên ngắn
    // "TBY" nên bắt theo tên ngắn sẽ trúng hai nút.
    const tby = () => badge("Trình bằng Yếu mà ảo tưởng hơn");
    fireEvent.click(tby());

    expect(tby().getAttribute("aria-pressed")).toBe("true");
    expect(actions.updateMySkillLevel).toHaveBeenCalledWith("tby");
  });

  it("bấm lại mức ĐANG chọn: bỏ khai, gửi chuỗi rỗng", () => {
    renderSection("tb");
    expand();
    // Khớp theo CÂU MÔ TẢ vì nó duy nhất; chữ "TB" là chuỗi con của cả "TBY"
    // lẫn "TBK" nên bắt theo tên ngắn sẽ trúng ba nút.
    expect(badge("Thắng do Tao Bao").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(badge("Thắng do Tao Bao"));

    expect(actions.updateMySkillLevel).toHaveBeenCalledWith("");
  });

  it("đổi sang mức khác thì mức cũ thôi được đánh dấu", () => {
    renderSection("yeu");
    expand();
    fireEvent.click(badge("Trung bình kém"));

    expect(badge("Yếu nhưng hay ra gió").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(badge("Trung bình kém").getAttribute("aria-pressed")).toBe("true");
    expect(actions.updateMySkillLevel).toHaveBeenCalledWith("tbk");
  });

  it("server báo lỗi: trả về mức cũ và báo cho member biết", async () => {
    actions.updateMySkillLevel.mockImplementation(async () => ({
      error: "hỏng rồi",
    }));
    renderSection("yeu");
    expand();

    fireEvent.click(badge("Trung bình kém"));
    // Lạc quan: đánh dấu ngay trước khi server trả lời.
    expect(badge("Trung bình kém").getAttribute("aria-pressed")).toBe("true");

    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(badge("Yếu nhưng hay ra gió").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(badge("Trung bình kém").getAttribute("aria-pressed")).toBe("false");
  });
});
