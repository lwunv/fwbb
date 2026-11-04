import type { NotificationGroup } from "./catalog";
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

/**
 * Đặt lại `readAt = null` cho đúng các tin `ids` (rollback khi đánh dấu đã đọc
 * lỗi). Chỉ đụng các tin đó, nên lần đọc khác chạy song song không bị xoá theo.
 */
export function markUnreadInPages(
  data: NotificationPages | undefined,
  ids: readonly number[],
): NotificationPages | undefined {
  if (!data || ids.length === 0) return data;
  const set = new Set(ids);
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((it) =>
        set.has(it.id) && it.readAt !== null ? { ...it, readAt: null } : it,
      ),
    })),
  };
}

/** Id các tin chưa đọc đang có trong cache danh sách. */
export function unreadIdsInPages(data: NotificationPages | undefined) {
  return (
    data?.pages.flatMap((p) =>
      p.items.filter((it) => it.readAt === null).map((it) => it.id),
    ) ?? []
  );
}

/** Số chưa đọc sau khi trả lại `n` tin về chưa đọc. */
export function incrementUnread(count: number | undefined, n: number) {
  return count === undefined ? count : count + n;
}

/** Danh sách nhóm đang tắt sau khi tắt (`mute`) hoặc bật lại một nhóm. */
export function setGroupMuted(
  muted: readonly NotificationGroup[],
  group: NotificationGroup,
  mute: boolean,
): NotificationGroup[] {
  const rest = muted.filter((g) => g !== group);
  return mute ? [...rest, group] : rest;
}
