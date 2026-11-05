"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { Bell, ChevronDown, Loader2, Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import {
  getMyNotificationPrefs,
  requestNotifyEmailVerification,
  updateMyNotificationPrefs,
} from "@/actions/notifications";
import {
  ADMIN_GROUPS,
  MEMBER_GROUPS,
  isGroupMutable,
  type NotificationGroup,
} from "@/lib/notifications/catalog";
import { setGroupMuted } from "@/lib/notifications/optimistic";
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
 * Bật/tắt là lạc quan: đổi cache ngay rồi gửi nền qua `fireAction`. Server
 * nhận cả danh sách nhóm đang tắt (không nhận delta), nên danh sách gửi đi được
 * đọc từ cache NGAY LÚC GỬI: lần thử lại của `fireAction` mang trạng thái mới
 * nhất, không gửi lại danh sách cũ làm tắt/bật nhầm nhóm vừa bấm sau. Lỗi thì
 * chỉ trả lại đúng nhóm vừa bấm. Mọi lần gửi xong (thành công hay lỗi) thì đọc
 * lại server để màn hình và server không lệch nhau.
 */
export function NotificationPrefsSection({
  scope,
  exchangeEnabled = false,
}: {
  scope: NotificationScope;
  /** Server component đọc cờ giao lưu 1 lần rồi truyền xuống; tắt thì ẩn nhóm. */
  exchangeEnabled?: boolean;
}) {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailResult, setEmailResult] = useQueryState("email");

  // Kết quả từ link trong mail (/me?email=verified|invalid): mở thẻ, báo kết
  // quả, rồi xoá tham số (replace, không thêm lịch sử) để tải lại không báo lần nữa.
  useEffect(() => {
    if (scope !== "member") return;
    if (emailResult !== "verified" && emailResult !== "invalid") return;
    setExpanded(true);
    if (emailResult === "verified") {
      toast.success(t("prefs.emailVerifiedToast"));
    } else {
      toast.error(t("prefs.emailInvalidToast"));
    }
    void queryClient.invalidateQueries({ queryKey: prefsKey(scope) });
    void setEmailResult(null);
  }, [scope, emailResult, setEmailResult, t, queryClient]);

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: prefsKey(scope),
    queryFn: async (): Promise<Prefs> => {
      const res = await getMyNotificationPrefs(scope);
      if ("error" in res) throw new Error(res.error);
      return res;
    },
  });

  const groups: readonly NotificationGroup[] = (
    scope === "admin" ? ADMIN_GROUPS : MEMBER_GROUPS
  ).filter((g) => g !== "exchange" || exchangeEnabled);
  const muted = data?.mutedGroups ?? [];

  // Số lần gửi chưa xong. Chỉ đọc lại server khi không còn lần nào đang chạy,
  // để bản đọc lại không ghi đè trạng thái lạc quan của lần bấm còn đang gửi.
  const inFlight = useRef(0);

  function toggle(group: NotificationGroup, on: boolean) {
    const key = prefsKey(scope);
    const current = queryClient.getQueryData<Prefs>(key);
    if (!current) return;
    const wasMuted = current.mutedGroups.includes(group);
    const patch = (mute: boolean) =>
      queryClient.setQueryData<Prefs>(key, (d) =>
        d
          ? { ...d, mutedGroups: setGroupMuted(d.mutedGroups, group, mute) }
          : d,
      );
    // Bản đọc server đang bay về có thể ghi đè trạng thái lạc quan.
    void queryClient.cancelQueries({ queryKey: key });
    patch(!on);

    const settle = () => {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };
    inFlight.current += 1;
    fireAction(
      async () => {
        const latest = queryClient.getQueryData<Prefs>(key);
        if (!latest) return { error: t("prefs.loadError") };
        return updateMyNotificationPrefs(scope, {
          mutedGroups: latest.mutedGroups,
        });
      },
      () => patch(wasMuted),
      { onSuccess: settle, onError: settle },
    );
  }

  function toggleEmail(on: boolean) {
    const key = prefsKey(scope);
    const current = queryClient.getQueryData<Prefs>(key);
    if (!current) return;
    const was = current.emailEnabled;
    const patch = (v: boolean) =>
      queryClient.setQueryData<Prefs>(key, (d) =>
        d ? { ...d, emailEnabled: v } : d,
      );
    void queryClient.cancelQueries({ queryKey: key });
    patch(on);
    inFlight.current += 1;
    const settle = () => {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };
    fireAction(
      () => updateMyNotificationPrefs(scope, { emailEnabled: on }),
      () => patch(was),
      { onSuccess: settle, onError: settle },
    );
  }

  async function sendVerification() {
    setSending(true);
    try {
      const res = await requestNotifyEmailVerification();
      if ("error" in res) toast.error(t("prefs.emailSendError"));
      else toast.success(t("prefs.emailSent"));
    } catch {
      toast.error(t("prefs.emailSendError"));
    } finally {
      setSending(false);
    }
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
              <div className="flex flex-col items-start gap-2 px-1">
                <p className="text-destructive text-sm">
                  {t("prefs.loadError")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={isRefetching}
                  onClick={() => void refetch()}
                >
                  {t("retry")}
                </Button>
              </div>
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
            {data && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex min-h-11 items-center gap-1.5 text-base font-medium">
                  <Mail
                    className="text-muted-foreground h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  {t("prefs.emailTitle")}
                </div>
                {data.email ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 text-base break-all">
                        {data.email}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-lg border px-2 py-0.5 text-sm font-medium",
                          data.emailVerified
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      >
                        {data.emailVerified
                          ? t("prefs.emailVerified")
                          : t("prefs.emailUnverified")}
                      </span>
                    </div>
                    {!data.emailVerified && scope === "member" && (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 w-full sm:w-auto"
                        disabled={sending}
                        onClick={() => void sendVerification()}
                      >
                        {sending && (
                          <Loader2 className="animate-spin" aria-hidden />
                        )}
                        {sending
                          ? t("prefs.emailSending")
                          : t("prefs.emailSend")}
                      </Button>
                    )}
                    <div className="flex min-h-11 items-center justify-between gap-3">
                      <span className="text-base">
                        {t("prefs.emailToggle")}
                      </span>
                      <Switch
                        checked={data.emailEnabled}
                        onCheckedChange={toggleEmail}
                        aria-label={t("prefs.emailToggle")}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {scope === "admin"
                      ? t("prefs.emailNoneAdmin")
                      : t("prefs.emailNone")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
