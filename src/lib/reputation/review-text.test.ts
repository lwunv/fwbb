import { describe, expect, it } from "vitest";
import { normalizeCommentBody } from "@/lib/exchange/comment-text";
import {
  checkReviewText,
  findBannedTerm,
  foldAscii,
  normalizeReviewComment,
} from "./review-text";

describe("checkReviewText", () => {
  it.each(["gọi 0912 345 678", "zalo.me/0912345678", "shopee.vn/abc"])(
    "holds phones and links: %s",
    (text) => {
      expect(checkReviewText(text)).toEqual({ hold: true, reason: "contact" });
    },
  );

  it.each([
    "đm",
    "ĐM sân",
    "d m",
    "đ.m",
    "vcl",
    "v.c.l",
    "óc chó",
    "đéo",
    "địt",
  ])("holds profanity with marks, caps and spacing: %s", (text) => {
    expect(checkReviewText(text)).toEqual({ hold: true, reason: "banned" });
    expect(findBannedTerm(text)).not.toBeNull();
  });

  it.each([
    "sân lớn",
    "các sân",
    "buổi tối",
    "đeo kính",
    "Nguyễn",
    "ngủ",
    "Cầu Giấy",
    "đi muộn",
    "dịch vụ",
    "gửi xe 5.000đ",
    "mở cửa 5:00-22:00",
    "giá 120.000/giờ",
    "Sân có con chó của chủ chạy quanh",
    "inbox DM chủ sân",
  ])("does not hold everyday words: %s", (text) => {
    expect(findBannedTerm(text)).toBeNull();
    expect(checkReviewText(text)).toEqual({ hold: false });
  });

  it("contact wins over banned", () => {
    expect(checkReviewText("đm gọi 0912 345 678")).toEqual({
      hold: true,
      reason: "contact",
    });
  });
});

describe("normalizeReviewComment", () => {
  it("normalize strips control chars like comments", () => {
    const raw = "  Sân\u0000 đẹp​\r\n\n\n\nGửi xe\u0007 rộng  ";
    expect(normalizeReviewComment(raw)).toBe(normalizeCommentBody(raw));
    expect(normalizeReviewComment(raw)).toBe("Sân đẹp\n\nGửi xe rộng");
  });
});

describe("foldAscii", () => {
  it("drops marks, maps đ to d and turns punctuation into single spaces", () => {
    expect(foldAscii("  Đ.M  Nguyễn-Văn, Cầu Giấy!! ")).toBe(
      "d m nguyen van cau giay",
    );
  });
});
