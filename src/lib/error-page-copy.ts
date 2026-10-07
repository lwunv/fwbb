/**
 * Chữ cho màn báo lỗi (`app/error.tsx` và `app/global-error.tsx`).
 *
 * Không đặt trong messages/*.json như phần còn lại của app: `global-error`
 * thay thế cả layout gốc, tức là không có NextIntlClientProvider. Mà lỗi hay
 * gặp nhất lại rơi đúng vào layout gốc (nó đọc `app_settings` từ DB), nên hai
 * màn lỗi dùng chung bộ chữ này để khỏi lệch nhau.
 */

export type ErrorPageLocale = "vi" | "en" | "zh";

export type ErrorPageCopy = {
  title: string;
  description: string;
  retry: string;
  retrying: string;
  home: string;
  codeLabel: string;
};

export const errorPageCopy: Record<ErrorPageLocale, ErrorPageCopy> = {
  vi: {
    title: "Trang chưa tải được",
    description:
      "Kết nối tới máy chủ vừa bị gián đoạn. Bạn bấm Thử lại nhé, thường chỉ một lần là được.",
    retry: "Thử lại",
    retrying: "Đang tải lại...",
    home: "Về trang chủ",
    codeLabel: "Mã lỗi",
  },
  en: {
    title: "This page didn't load",
    description:
      "The connection to the server dropped for a moment. Tap Try again, it usually works on the first try.",
    retry: "Try again",
    retrying: "Reloading...",
    home: "Go to home",
    codeLabel: "Error code",
  },
  zh: {
    title: "页面暂时无法加载",
    description: "与服务器的连接刚刚中断了。请点击“重试”，通常一次就能恢复。",
    retry: "重试",
    retrying: "正在重新加载...",
    home: "返回首页",
    codeLabel: "错误代码",
  },
};

export function isErrorPageLocale(value: unknown): value is ErrorPageLocale {
  return value === "vi" || value === "en" || value === "zh";
}

/** Đọc cookie `locale` (cùng cookie `src/i18n/request.ts` dùng), không hợp lệ thì về `vi`. */
export function localeFromCookie(cookie: string): ErrorPageLocale {
  const match = cookie.match(/(?:^|;\s*)locale=([^;]*)/);
  const value = match?.[1];
  return isErrorPageLocale(value) ? value : "vi";
}
