import { describe, it, expect } from "vitest";
import { dropConvergedSkillOverrides } from "./skill-overrides";

describe("dropConvergedSkillOverrides", () => {
  it("bỏ bản tạm của member mà server đã khớp, giữ member server chưa khớp", () => {
    const overrides = { 1: "tbk", 2: "tb", 3: null } as const;
    const members = [
      { id: 1, skillLevel: "tbk" as const }, // đã khớp → bỏ
      { id: 2, skillLevel: "yeu" as const }, // chưa khớp (đang lưu) → giữ
      { id: 3, skillLevel: null }, // xoá khai báo đã khớp → bỏ
    ];
    expect(dropConvergedSkillOverrides(overrides, members)).toEqual({
      2: "tb",
    });
  });

  it("không có gì để bỏ → trả lại đúng object cũ (không render thừa)", () => {
    const overrides = { 2: "tb" as const };
    expect(
      dropConvergedSkillOverrides(overrides, [{ id: 2, skillLevel: "yeu" }]),
    ).toBe(overrides);
  });
});
