// @vitest-environment jsdom
/**
 * Nhãn trình độ cạnh tên member ở danh sách vote.
 *
 * Điều quan trọng nhất: member CHƯA khai thì không render gì cả. Phần lớn
 * member sẽ không khai, mà mỗi dòng vote là chỗ chật; render một ô rỗng hay
 * một dấu gạch cho mỗi người là tự làm danh sách rối thêm.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { SkillChip } from "./skill-chip";
import { SKILL_LEVELS, SKILL_BADGE_CLASS } from "@/lib/skill-level";

afterEach(cleanup);

function renderChip(
  level: Parameters<typeof SkillChip>[0]["level"],
  withBlurb = false,
) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SkillChip level={level} withBlurb={withBlurb} />
    </NextIntlClientProvider>,
  );
}

describe("nhãn trình độ", () => {
  it("chưa khai thì không chiếm một pixel nào", () => {
    const { container } = renderChip(null);
    expect(container.innerHTML).toBe("");
  });

  it("undefined cũng vậy (member từ payload cũ chưa có cột này)", () => {
    const { container } = renderChip(undefined);
    expect(container.innerHTML).toBe("");
  });

  it("đã khai thì hiện tên ngắn kèm đúng màu của mức đó", () => {
    for (const level of SKILL_LEVELS) {
      cleanup();
      renderChip(level);
      const el = screen.getByText(viMessages.me.skillShort[level]);
      expect(el.className, level).toContain(
        SKILL_BADGE_CLASS[level].split(" ")[0],
      );
    }
  });

  it("chữ nhỏ để không lấn át tên member", () => {
    renderChip("tb");
    const el = screen.getByText("TB");
    expect(el.className).toContain("text-[11px]");
  });
});

describe("câu mô tả của mức trình độ", () => {
  it("mặc định KHÔNG kèm: danh sách vote trang chủ phải gọn", () => {
    renderChip("tb");
    expect(screen.queryByText(/Thắng do Tao Bao/)).toBeNull();
  });

  /**
   * Điều quan trọng nhất của lần sửa 28/10/2026: ngay cả khi BẬT, câu mô tả
   * vẫn không nằm sẵn trên dòng. Nó dài hơn cả tên người; để nó thường trực
   * thì hàng tên bị đẩy vỡ hoặc cắt cụt trên điện thoại.
   */
  it("bật lên nhưng chưa ai hỏi: câu mô tả không có trong DOM", () => {
    renderChip("tb", true);
    expect(screen.getByText("TB")).toBeTruthy();
    expect(
      screen.queryByText("Thắng do Tao Bao, thua do Thằng Bạn"),
    ).toBeNull();
  });

  it("chạm vào nhãn thì câu mô tả hiện ra, chạm lần nữa thì mất", () => {
    renderChip("tby", true);
    const chip = screen.getByRole("button", { name: "TBY" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(chip);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Trình bằng Yếu mà ảo tưởng hơn");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    // Bong bóng phải được mô tả cho trình đọc màn hình, không chỉ là chữ nổi.
    expect(chip.getAttribute("aria-describedby")).toBe(tip.getAttribute("id"));

    fireEvent.click(chip);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("rê chuột vào thì hiện, rê ra thì mất, không cần bấm", () => {
    renderChip("tb", true);
    const chip = screen.getByRole("button", { name: "TB" });

    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toContain("Tao Bao");

    fireEvent.pointerLeave(chip);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  /**
   * Ngón tay chạm cũng bắn `pointerenter`. Nếu coi đó là rê chuột thì nhãn
   * hiện ra rồi mất ngay khi nhấc tay, mà cú `click` ngay sau đó lại ghim rồi
   * bỏ ghim, thành ra chạm một cái không ra gì cả.
   */
  it("chạm ngón tay KHÔNG tính là rê chuột", () => {
    renderChip("tb", true);
    const chip = screen.getByRole("button", { name: "TB" });
    fireEvent.pointerEnter(chip, { pointerType: "touch" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("chạm ra ngoài thì bong bóng tự đóng", () => {
    renderChip("tb", true);
    fireEvent.click(screen.getByRole("button", { name: "TB" }));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("chưa khai thì bật hay tắt cũng không hiện gì", () => {
    const { container } = renderChip(null, true);
    expect(container.innerHTML).toBe("");
  });
});
