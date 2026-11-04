"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import {
  getMyNotificationPrefs,
  updateMyNotificationPrefs,
} from "@/actions/notifications";
import {
  ADMIN_GROUPS,
  MEMBER_GROUPS,
  isGroupMutable,
  type NotificationGroup,
} from "@/lib/notifications/catalog";
import type { NotificationScope } from "./use-notifications";

type Prefs = Exclude<
  Awaited<ReturnType<typeof getMyNotificationPrefs>>,
  { error: string }
>;

const prefsKey = (scope: NotificationScope) =>
  ["notification-prefs", scope] as const;

/**
 * Thẻ thu gọn "Thông báo" ở /me và trang tài khoản admin: mỗi nhóm một công
 * tắc. Nhóm toàn tin bắt buộc (tài khoản) hiện khoá kèm lời giải thích thay vì
 * ẩn đi, để người dùng biết vì sao không tắt được.
 *
 * Bật/tắt là lạc quan: đổi cache ngay, gửi nền qua `fireAction`, lỗi thì trả
 * cache về như cũ. Mỗi lần gửi cả danh sách nhóm đang tắt (không gửi delta) nên
 * hai lần bấm liền nhau vẫn hội tụ về trạng thái cuối trên màn hình.
 */
export function NotificationPrefsSection({
  scope,
}: {
  scope: NotificationScope;
}) {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: prefsKey(scope),
    queryFn: async (): Promise<Prefs> => {
      const res = await getMyNotificationPrefs(scope);
      if ("error" in res) throw new Error(res.error);
      return res;
    },
  });

  const groups: readonly NotificationGroup[] =
    scope === "admin" ? ADMIN_GROUPS : MEMBER_GROUPS;
  const muted = data?.mutedGroups ?? [];

  function toggle(group: NotificationGroup, on: boolean) {
    const before = queryClient.getQueryData<Prefs>(prefsKey(scope));
    if (!before) return;
    const next = on
      ? before.mutedGroups.filter((g) => g !== group)
      : [...before.mutedGroups.filter((g) => g !== group), group];
    queryClient.setQueryData<Prefs>(prefsKey(scope), {
      ...before,
      mutedGroups: next,
    });
    fireAction(
      () => updateMyNotificationPrefs(scope, { mutedGroups: next }),
      () => queryClient.setQueryData<Prefs>(prefsKey(scope), before),
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="hover:bg-accent/50 flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left transition-colors"
        >
          <Bell className="text-primary h-5 w-5 shrink-0" />
          <span className="font-semibold">{t("prefs.title")}</span>
          {data && (
            <span className="text-muted-foreground ml-auto shrink-0 rounded-lg border px-2 py-0.5 text-sm font-medium">
              {muted.length === 0
                ? t("prefs.allOn")
                : t("prefs.mutedCount", { count: muted.length })}
            </span>
          )}
          <ChevronDown
            className={cn(
              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
              !data && "ml-auto",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded && (
          <div className="mt-2 space-y-2">
            <p className="text-muted-foreground px-1 text-sm">
              {t("prefs.hint")}
            </p>
            {isPending ? (
              Array.from({ length: groups.length }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))
            ) : isError ? (
              <p className="text-destructive px-1 text-sm">
                {t("prefs.loadError")}
              </p>
            ) : (
              groups.map((group) => {
                const mutable = isGroupMutable(group);
                const label = t(`groups.${group}`);
                return (
                  <div
                    key={group}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-base font-medium">
                        {!mutable && (
                          <Lock
                            className="text-muted-foreground h-4 w-4 shrink-0"
                            aria-hidden
                          />
                        )}
                        {label}
                      </div>
                      {!mutable && (
                        <p className="text-muted-foreground text-sm">
                          {t("prefs.mandatory")}
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={mutable ? !muted.includes(group) : true}
                      disabled={!mutable}
                      onCheckedChange={(v) => toggle(group, v)}
                      aria-label={label}
                    />
                  </div>
                );
              })
            )}
            {/* TASK-14-EMAIL-SLOT: Task 14 thêm phần email (công tắc emailEnabled,
                địa chỉ, xác minh) ngay dưới danh sách nhóm. `data.email`,
                `data.emailEnabled`, `data.emailVerified` đã có sẵn trong Prefs. */}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
