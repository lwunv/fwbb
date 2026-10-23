/**
 * Trình độ member: danh sách mức, màu, và việc nhận dữ liệu từ ngoài vào.
 *
 * Bài đáng giá nhất ở đây là bài màu trùng: năm mức mà hai mức cùng lớp màu
 * thì nhìn không phân biệt được, nhưng không có gì đỏ, không ai phát hiện cho
 * tới khi có người hỏi "sao hai cái này giống nhau".
 */
import { describe, expect, it } from "vitest";
import {
  SKILL_LEVELS,
  SKILL_BADGE_CLASS,
  parseSkillLevel,
  isSkillLevel,
} from "./skill-level";
import viMessages from "@/i18n/messages/vi.json";
import enMessages from "@/i18n/messages/en.json";
import zhMessages from "@/i18n/messages/zh.json";

describe("các mức trình độ", () => {
  it("đúng năm mức, đúng thứ tự user liệt kê", () => {
    expect([...SKILL_LEVELS]).toEqual(["tapChoi", "yeu", "tby", "tb", "tbk"]);
  });

  it("mỗi mức một màu KHÁC NHAU", () => {
    const classes = SKILL_LEVELS.map((k) => SKILL_BADGE_CLASS[k]);
    expect(new Set(classes).size).toBe(SKILL_LEVELS.length);
  });

  it("mức nào cũng có màu cho nền tối", () => {
    for (const k of SKILL_LEVELS) {
      expect(SKILL_BADGE_CLASS[k], k).toContain("dark:");
    }
  });
});

describe("nhận giá trị từ ngoài vào", () => {
  it("mức hợp lệ thì giữ nguyên", () => {
    for (const k of SKILL_LEVELS) {
      expect(parseSkillLevel(k)).toBe(k);
    }
  });

  it("chuỗi rỗng = member bỏ khai, trả null", () => {
    expect(parseSkillLevel("")).toBeNull();
  });

  it("giá trị rác KHÔNG lọt vào DB", () => {
    for (const junk of ["pro", "TB", " tb", 1, null, undefined, {}]) {
      expect(parseSkillLevel(junk), String(junk)).toBeNull();
      expect(isSkillLevel(junk), String(junk)).toBe(false);
    }
  });
});

describe("file dịch", () => {
  // Thiếu một dòng dịch thì next-intl ném lỗi ngay giữa màn hình member, chứ
  // không im lặng rơi về tiếng Anh. Bắt ở đây rẻ hơn nhiều.
  const bundles = { vi: viMessages, en: enMessages, zh: zhMessages } as const;

  for (const [locale, msgs] of Object.entries(bundles)) {
    it(`${locale}: mức nào cũng có tên ngắn và câu mô tả`, () => {
      const me = (msgs as Record<string, Record<string, unknown>>).me;
      const short = me.skillShort as Record<string, string>;
      const blurb = me.skillBlurb as Record<string, string>;
      for (const k of SKILL_LEVELS) {
        expect(short?.[k], `${locale}.skillShort.${k}`).toBeTruthy();
        expect(blurb?.[k], `${locale}.skillBlurb.${k}`).toBeTruthy();
      }
    });
  }
});
