"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { SkeletonCard } from "@/components/shared/skeleton-card";
import {
  notificationHref,
  type NotificationView,
} from "@/lib/notifications/render";
import { NotificationRow } from "./notification-row";
import {
  useNotificationActions,
  useNotificationList,
  useUnreadCount,
  type NotificationScope,
} from "./use-notifications";

/** Nội dung dùng chung cho bottom sheet (mobile) và dialog (từ `sm:`). */
export function NotificationPanel({
  scope,
  zaloGroupUrl,
  onNavigate,
}: {
  scope: NotificationScope;
  zaloGroupUrl?: string;
  /** Đóng panel khi đã chọn một tin. */
  onNavigate: () => void;
}) {
  const t = useTranslations("notifications.bell");
  const router = useRouter();
  const list = useNotificationList(scope, true);
  const { data: unread = 0 } = useUnreadCount(scope);
  const { markRead, markAll } = useNotificationActions(scope);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const select = (item: NotificationView) => {
    markRead(item);
    onNavigate();
    router.push(notificationHref(item, scope));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {unread > 0 && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start"
          onClick={markAll}
        >
          {t("markAll")}
        </Button>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {list.isPending ? (
          Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} variant="row" />
          ))
        ) : list.isError ? (
          <EmptyState variant="inline" icon={Bell} title={t("error")} />
        ) : items.length === 0 ? (
          <EmptyState variant="inline" icon={Bell} title={t("empty")} />
        ) : (
          items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              scope={scope}
              zaloGroupUrl={zaloGroupUrl}
              onSelect={select}
            />
          ))
        )}
        {list.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {t("loadMore")}
          </Button>
        )}
      </div>
    </div>
  );
}
