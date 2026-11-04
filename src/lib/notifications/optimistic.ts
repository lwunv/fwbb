import type { NotificationView } from "./render";

/** Hình dữ liệu của `useInfiniteQuery` danh sách thông báo. */
export type NotificationPages = {
  pages: { items: NotificationView[]; nextCursor: unknown }[];
  pageParams: unknown[];
};

/**
 * Đặt `readAt` cho 1 tin (hoặc mọi tin khi `id` = "all") trong cache danh sách.
 * Thuần và không đổi tham chiếu khi không có gì đổi, để dùng được cả trong
 * Server Component lẫn khi rollback.
 */
export function markReadInPages(
  data: NotificationPages | undefined,
  id: number | "all",
  readAt: string,
): NotificationPages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((it) =>
        (id === "all" || it.id === id) && it.readAt === null
          ? { ...it, readAt }
          : it,
      ),
    })),
  };
}

/** Số chưa đọc sau khi đọc `n` tin; không bao giờ âm. */
export function decrementUnread(count: number | undefined, n: number) {
  return count === undefined ? count : Math.max(0, count - n);
}
