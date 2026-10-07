import { describe, it, expect } from "vitest";
import { errorPageCopy, localeFromCookie } from "./error-page-copy";

describe("localeFromCookie", () => {
  it.each([
    ["locale=en", "en"],
    ["theme=dark; locale=zh; other=1", "zh"],
    ["locale=vi", "vi"],
  ])("đọc được locale trong %s", (cookie, expected) => {
    expect(localeFromCookie(cookie)).toBe(expected);
  });

  it.each([
    ["chuỗi rỗng", ""],
    ["không có cookie locale", "theme=dark"],
    ["locale lạ", "locale=fr"],
    ["tên cookie chỉ trùng đuôi", "mylocale=en"],
  ])("rơi về vi khi %s", (_label, cookie) => {
    expect(localeFromCookie(cookie)).toBe("vi");
  });
});

describe("errorPageCopy", () => {
  it("ba ngôn ngữ có đủ cùng bộ khoá, không khoá nào rỗng", () => {
    const keys = Object.keys(errorPageCopy.vi).sort();
    for (const copy of Object.values(errorPageCopy)) {
      expect(Object.keys(copy).sort()).toEqual(keys);
      for (const value of Object.values(copy))
        expect(value.trim()).not.toBe("");
    }
  });

  it("văn bản không có em dash (quy ước văn phong của app)", () => {
    for (const copy of Object.values(errorPageCopy)) {
      for (const value of Object.values(copy))
        expect(value).not.toMatch(/[—–]/);
    }
  });
});
