// Kiểm chữ nhận xét đánh giá sân (G2d). Thuần, client và server dùng chung.
//
// Từ chửi so trên chữ CÒN DẤU (quyết định 28): bỏ dấu thì "lớn", "các",
// "buổi", "đeo" trùng với từ tục và giữ nhầm nhận xét bình thường. Chỉ vài viết
// tắt không dấu không trùng chữ thường mới so sau khi bỏ dấu, còn "dm"/"vcl"
// chỉ tính khi viết tách từng chữ ("d m", "đ.m") vì "DM" là "nhắn riêng".

import {
  detectContact,
  normalizeCommentBody,
} from "@/lib/exchange/comment-text";

/** Chuẩn hoá nhận xét giống hệt bình luận buổi giao lưu. */
export function normalizeReviewComment(raw: string): string {
  return normalizeCommentBody(raw);
}

/** So trên chữ thường NFC còn dấu, nguyên từ. */
export const BANNED_EXACT = [
  "đm",
  "đmm",
  "đcm",
  "địt",
  "đéo",
  "đĩ",
  "đụ",
  "đù má",
  "lồn",
  "cặc",
  "buồi",
  "óc chó",
  "súc vật",
  "mất dạy",
  "ngu như bò",
  "vãi lồn",
] as const;

/** So trên từng token sau `foldAscii`. */
export const BANNED_ASCII = [
  "dmm",
  "dcm",
  "dkm",
  "vcl",
  "vkl",
  "clm",
  "cmm",
  "loz",
] as const;

/** Chỉ so trên chuỗi ghép từ các token 1 chữ cái liền nhau ("d m", "v.c.l"). */
export const BANNED_SQUEEZED = ["dm", "vcl", "dcm", "dmm"] as const;

const BANNED_ASCII_SET: ReadonlySet<string> = new Set(BANNED_ASCII);
const BANNED_SQUEEZED_SET: ReadonlySet<string> = new Set(BANNED_SQUEEZED);
const SQUEEZED_MAX_LEN = Math.max(...BANNED_SQUEEZED.map((t) => t.length));

// Ranh giới từ theo chữ/số Unicode: `\b` của JS chỉ hiểu ASCII nên "đm" trong
// "đmx" hay "xđm" sẽ lọt hoặc khớp nhầm.
const EXACT_RES = BANNED_EXACT.map(
  (term) =>
    [
      term,
      new RegExp(
        `(?<![\\p{L}\\p{M}\\p{N}])${term}(?![\\p{L}\\p{M}\\p{N}])`,
        "u",
      ),
    ] as const,
);

/** NFD, bỏ dấu, `đ` → `d`, chữ thường, ký tự ngoài `[a-z0-9]` thành một dấu cách. */
export function foldAscii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Trả từ cấm đầu tiên tìm thấy, hoặc null. Với dạng viết tách, xét mọi đoạn
 * liền nhau trong một chuỗi token 1 chữ cái để "ở d m" (→ "o d m") không lọt.
 */
export function findBannedTerm(comment: string): string | null {
  const marked = comment.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
  for (const [term, re] of EXACT_RES) {
    if (re.test(marked)) return term;
  }

  const tokens = foldAscii(comment).split(" ");
  for (const tok of tokens) {
    if (BANNED_ASCII_SET.has(tok)) return tok;
  }

  let run: string[] = [];
  const checkRun = (): string | null => {
    for (let i = 0; i < run.length; i++) {
      let joined = run[i];
      for (let j = i + 1; j < run.length && j - i < SQUEEZED_MAX_LEN; j++) {
        joined += run[j];
        if (BANNED_SQUEEZED_SET.has(joined)) return joined;
      }
    }
    return null;
  };
  for (const tok of tokens) {
    if (/^[a-z]$/.test(tok)) {
      run.push(tok);
      continue;
    }
    const hit = checkRun();
    if (hit) return hit;
    run = [];
  }
  return checkRun();
}

/** Nhận xét có phải vào hàng chờ admin không; sđt/link được ưu tiên báo trước. */
export function checkReviewText(
  comment: string,
): { hold: false } | { hold: true; reason: "contact" | "banned" } {
  const text = normalizeReviewComment(comment);
  const contact = detectContact(text);
  if (contact.phone || contact.link) return { hold: true, reason: "contact" };
  if (findBannedTerm(text)) return { hold: true, reason: "banned" };
  return { hold: false };
}
