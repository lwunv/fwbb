"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/notifications";
import { fireAction } from "@/lib/optimistic-action";
import {
  decrementUnread,
  incrementUnread,
  markReadInPages,
  markUnreadInPages,
  unreadIdsInPages,
  type NotificationPages,
} from "@/lib/notifications/optimistic";
import type { NotificationView } from "@/lib/notifications/render";

export type NotificationScope = "member" | "admin";
type Cursor = { createdAt: string; id: number };

const unreadKey = (scope: NotificationScope) =>
  ["notifications", scope, "unread"] as const;
const listKey = (scope: NotificationScope) =>
  ["notifications", scope, "list"] as const;

/**
 * Số chưa đọc của chuông. `pathname` nằm trong key để chuyển trang là đếm lại
 * (staleTime 15s chặn đếm dồn); Providers tắt refetchOnWindowFocus toàn cục
 * nên bật riêng ở đây. Không polling (quota Turso).
 */
export function useUnreadCount(scope: NotificationScope) {
  const pathname = usePathname();
  return useQuery({
    queryKey: [...unreadKey(scope), pathname],
    queryFn: () => getUnreadNotificationCount(scope),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

/** Danh sách theo cursor; chỉ chạy khi panel đang mở. */
export function useNotificationList(
  scope: NotificationScope,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: listKey(scope),
    enabled,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }) => {
      const res = await listNotifications(scope, pageParam);
      if ("error" in res) throw new Error(res.error);
      return res;
    },
    getNextPageParam: (last) => last.nextCursor,
    // Mở lại panel là lấy mới, không dùng bản cũ 60s của Providers.
    staleTime: 0,
  });
}

/**
 * Huỷ các lần đọc đang bay về trước khi sửa cache lạc quan, để bản cũ từ server
 * không ghi đè lên (TanStack "optimistic updates").
 */
function cancelInFlight(qc: QueryClient, scope: NotificationScope) {
  void qc.cancelQueries({ queryKey: listKey(scope) });
  void qc.cancelQueries({ queryKey: unreadKey(scope) });
}

/**
 * Optimistic: đặt `readAt` + giảm đếm ngay. Lỗi thì chỉ trả lại đúng các tin
 * vừa đổi và cộng lại đúng số vừa trừ, không chép đè cả snapshot (sẽ xoá mất
 * lần đọc khác chạy song song).
 */
export function useNotificationActions(scope: NotificationScope) {
  const qc = useQueryClient();

  const markRead = useCallback(
    (item: NotificationView) => {
      if (item.readAt !== null) return;
      cancelInFlight(qc, scope);
      qc.setQueryData<NotificationPages>(listKey(scope), (d) =>
        markReadInPages(d, item.id, new Date().toISOString()),
      );
      // Đếm đang là 0 thì không trừ được, nên rollback cũng không cộng lại.
      const counts = qc.getQueriesData<number>({ queryKey: unreadKey(scope) });
      qc.setQueriesData<number>({ queryKey: unreadKey(scope) }, (c) =>
        decrementUnread(c, 1),
      );
      fireAction(
        () => markNotificationRead(scope, item.id),
        () => {
          qc.setQueryData<NotificationPages>(listKey(scope), (d) =>
            markUnreadInPages(d, [item.id]),
          );
          for (const [key, value] of counts) {
            if (value)
              qc.setQueryData<number>(key, (c) => incrementUnread(c, 1));
          }
        },
      );
    },
    [qc, scope],
  );

  const markAll = useCallback(() => {
    cancelInFlight(qc, scope);
    const ids = unreadIdsInPages(
      qc.getQueryData<NotificationPages>(listKey(scope)),
    );
    const counts = qc.getQueriesData<number>({ queryKey: unreadKey(scope) });
    qc.setQueryData<NotificationPages>(listKey(scope), (d) =>
      markReadInPages(d, "all", new Date().toISOString()),
    );
    qc.setQueriesData<number>({ queryKey: unreadKey(scope) }, () => 0);
    fireAction(
      () => markAllNotificationsRead(scope),
      () => {
        qc.setQueryData<NotificationPages>(listKey(scope), (d) =>
          markUnreadInPages(d, ids),
        );
        for (const [key, value] of counts) {
          qc.setQueryData<number>(key, (c) => incrementUnread(c, value ?? 0));
        }
      },
    );
  }, [qc, scope]);

  return { markRead, markAll };
}
