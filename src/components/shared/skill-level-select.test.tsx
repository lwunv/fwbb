// @vitest-environment jsdom
/**
 * Dropdown trình độ gộp chip (yêu cầu user 6/11/2026): nút mang màu mức đang
 * chọn, rê chuột hiện câu mô tả; mỗi mức trong menu có màu riêng + mô tả.
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
import { SKILL_BADGE_CLASS } from "@/lib/skill-level";
import { SkillLevelSelect } from "./skill-level-select";

function renderSelect(value: string, onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <SkillLevelSelect value={value} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

const firstClass = (lv: keyof typeof SKILL_BADGE_CLASS) =>
  SKILL_BADGE_CLASS[lv].split(" ")[0];

describe("SkillLevelSelect", () => {
  afterEach(cleanup);

  it("nút hiện mức đang chọn với màu của mức đó", () => {
    renderSelect("tby");
    const btn = screen.getByRole("button", { name: /TBY/ });
    expect(btn.className).toContain(firstClass("tby"));
  });

  it("rê chuột vào nút → hiện câu mô tả của mức", async () => {
    renderSelect("tby");
    const btn = screen.getByRole("button", { name: /TBY/ });
    fireEvent.pointerEnter(btn, { pointerType: "mouse" });
    await waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toBe(
        viMessages.me.skillBlurb.tby,
      ),
    );
  });

  it("mở menu: mỗi mức có màu riêng + mô tả, chọn thì gọi onChange", async () => {
    const onChange = renderSelect("");
    fireEvent.click(screen.getByRole("button", { name: /Chưa khai/ }));
    const tbk = await screen.findByRole("menuitem", { name: /TBK/ });
    expect(tbk.innerHTML).toContain(firstClass("tbk"));
    expect(tbk.getAttribute("title")).toBe(viMessages.me.skillBlurb.tbk);
    const yeu = screen.getByRole("menuitem", { name: /^Yếu/ });
    expect(yeu.innerHTML).toContain(firstClass("yeu"));
    fireEvent.click(tbk);
    expect(onChange).toHaveBeenCalledWith("tbk");
  });
});
