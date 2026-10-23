// @vitest-environment jsdom
/**
 * Nhãn trình độ cạnh tên member ở danh sách vote.
 *
 * Điều quan trọng nhất: member CHƯA khai thì không render gì cả. Phần lớn
 * member sẽ không khai, mà mỗi dòng vote là chỗ chật; render một ô rỗng hay
 * một dấu gạch cho mỗi người là tự làm danh sách rối thêm.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { SkillChip } from "./skill-chip";
import { SKILL_LEVELS, SKILL_BADGE_CLASS } from "@/lib/skill-level";

afterEach(cleanup);

function renderChip(level: Parameters<typeof SkillChip>[0]["level"]) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SkillChip level={level} />
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
