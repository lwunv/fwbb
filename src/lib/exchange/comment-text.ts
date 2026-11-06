// Thuần (không DB, không server-only): client và server dùng chung.

/** Chuẩn hoá chữ bình luận trước khi đếm độ dài, kiểm tra và lưu. */
export function normalizeCommentBody(raw: string): string {
  return (
    raw
      .normalize("NFC")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
      // Ký tự vô hình (zero-width, bidi) chèn giữa số/tên miền để né kiểm tra sđt/link.
      .replace(/[​-‏‪-‮⁠﻿]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Che trước ngày, giờ, tiền để chuỗi như "09.11.2026 19:30" hay "1.200.000"
// không bị đọc nhầm thành số điện thoại. KHÔNG bỏ khoảng trắng cả bài: gộp
// số ở các câu khác nhau sẽ báo nhầm.
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g;
const TIME_RE = /\b\d{1,2}[:h]\d{2}\b/g;
// (?<![\d.,]) để "0912.345.678" không bị cắt mất cụm "345.678" như tiền.
const MONEY_RE = /(?<![\d.,])\b[1-9]\d{0,2}(?:[.,]\d{3})+(?![.,]?\d)/g;
const PHONE_RE = /(?<!\d)(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/;

const LINK_RE =
  /https?:\/\/|www\.|zalo\.me|fb\.com|t\.me|m\.me|[a-z0-9-]+\.(?:com|vn|net|org|me|io|co|link|ly|xyz|info|top|shop|store|site|online|app|gg|tv)\b/i;

/** Phát hiện sđt/link trong bình luận để giữ lại chờ host duyệt. */
export function detectContact(body: string): { phone: boolean; link: boolean } {
  const masked = body
    .replace(DATE_RE, " ")
    .replace(TIME_RE, " ")
    .replace(MONEY_RE, " ");
  return { phone: PHONE_RE.test(masked), link: LINK_RE.test(body) };
}
