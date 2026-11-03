const FALLBACK = "/giao-luu";
const PLACEHOLDER_ORIGIN = "https://x.invalid";

/**
 * Chỉ cho phép điều hướng nội bộ sau đăng nhập. Gọi ở MỌI chỗ redirect, không
 * chỉ lúc lưu `next`, vì giá trị có thể đi qua cookie/URL do client kiểm soát.
 * Ký tự điều khiển và `\` bị chặn thẳng: trình duyệt bỏ tab/xuống dòng và đổi
 * `\` thành `/` khi phân giải URL, nên `/\t/evil.com` thành `//evil.com`.
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return FALLBACK;
  if (/[\x00-\x1F\x7F\\]/.test(raw)) return FALLBACK;
  try {
    const u = new URL(raw, PLACEHOLDER_ORIGIN);
    if (u.origin !== PLACEHOLDER_ORIGIN) return FALLBACK;
    const out = u.pathname + u.search + u.hash;
    // new URL() gập "." / ".." (cả %2e) nên "/..//evil.com" thành "//evil.com",
    // vẫn cùng origin giả nhưng trình duyệt hiểu là URL cùng giao thức tới host khác.
    if (out.startsWith("//") || out.startsWith("/\\")) return FALLBACK;
    return out;
  } catch {
    return FALLBACK;
  }
}
