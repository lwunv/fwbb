"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminDebtNotifications } from "@/actions/admin-notifications";
import { cn, formatVND } from "@/lib/utils";
import {
  latestCrossingByMember,
  notificationHref,
} from "@/lib/admin-notifications-view";
import {
  isNotificationUnread,
  markNotificationRead,
  notificationKey,
  useNotificationReadState,
} from "@/lib/notification-read-state";

/**
 * Lấy lại tối đa 5 phút một lần. KHÔNG đặt trong layout server: các trang
 * admin tự `router.refresh()` theo nhịp, mỗi lần chạy lại layout là quét cả
 * sổ cái (từng làm hết hạn mức Turso, xem HEAVY_POLL_MS).
 */
const STALE_MS = 5 * 60_000;

export const ADMIN_DEBT_QUERY_KEY = ["admin-debt-notifications"] as const;

/**
 * Chuông cạnh logo Admin (yêu cầu user 6/11/2026). Số đỏ = mọi member trong
 * quỹ đang âm. Bấm mở danh sách nhanh (ngăn trượt ngang từ trái, phía sidebar), link sang trang thông
 * báo đầy đủ có lịch sử. Khi N1 (thông báo đầy đủ) lên prod thì chuông N1 thay
 * chỗ này.
 */
export function AdminDebtBell({ className }: { className?: string }) {
  const t = useTranslations("adminNotifications");
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ADMIN_DEBT_QUERY_KEY,
    queryFn: () => getAdminDebtNotifications(),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });

  const result = data && !("error" in data) ? data : null;
  const owing = result?.owing ?? [];
  const readState = useNotificationReadState();
  const [now] = useState(() => new Date());
  const latestByMember = useMemo(
    () => latestCrossingByMember(result?.history ?? []),
    [result],
  );
  const count = owing.length;

  return (
    <>
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        ref={bellRef}
        aria-expanded={open}
        onClick={() => {
          // Bấm chuông lần nữa thì đóng (user 6/11/2026).
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          // Chuông nằm trong layout, không unmount khi chuyển trang: mở ra là
          // lấy lại 1 lần (không poll) để số không đứng yên giá trị cũ.
          void refetch();
        }}
        aria-label={count > 0 ? t("bellLabelCount", { count }) : t("bellLabel")}
        className={cn(
          "hover:bg-sidebar-accent relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
          className,
        )}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {count > 0 && (
          <span
            data-testid="admin-bell-badge"
            className="bg-destructive text-destructive-foreground absolute top-1 right-1 inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-bold"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </motion.button>

      <Sheet
        open={open}
        onOpenChange={(next, details) => {
          // Ngăn không modal nên bấm vào chuông cũng bị base-ui tính là "chạm
          // ra ngoài" và đóng ngăn TRƯỚC onClick, rồi onClick lại mở ra. Bỏ qua
          // lần đóng đó để onClick của chuông tự bật/tắt.
          const target = details.event?.target;
          if (
            !next &&
            details.reason === "outside-press" &&
            target instanceof Node &&
            bellRef.current?.contains(target)
          ) {
            return;
          }
          setOpen(next);
        }}
        modal={false}
      >
        <SheetContent
          side="left"
          // Desktop: trượt ra NGAY SAU sidebar cố định (lg:w-60), cả nền mờ lẫn
          // ngăn đều chừa sidebar ra để không che nó (yêu cầu user 6/11/2026).
          overlayClassName="lg:left-60"
          className="flex h-dvh w-80 max-w-[85vw] flex-col gap-0 overflow-hidden p-0 lg:left-60!"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{t("owingTitle")}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {isPending ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : isError || !result ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <p className="text-destructive text-center text-base">
                  {t("loadError")}
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="border-border hover:bg-muted min-h-11 rounded-lg border px-4 text-base"
                >
                  {t("retry")}
                </button>
              </div>
            ) : owing.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-base">
                {t("empty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {owing.map((o) => {
                  const latest = latestByMember.get(o.memberId);
                  const unread = latest
                    ? isNotificationUnread(
                        readState,
                        notificationKey(latest),
                        latest.at,
                        now,
                      )
                    : false;
                  return (
                    <li key={o.memberId}>
                      <Link
                        href={notificationHref(o.name)}
                        onClick={() => {
                          if (latest) {
                            markNotificationRead(notificationKey(latest));
                          }
                          setOpen(false);
                        }}
                        className={cn(
                          "hover:bg-muted/60 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors",
                          unread && "bg-primary/[0.06]",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          {/* Trong link: xuống tối đa 2 dòng, không cắt cụt. */}
                          <p className="line-clamp-2 text-base break-words">
                            {o.name}
                          </p>
                          {o.overLimit && (
                            <span className="border-destructive/40 bg-destructive/10 text-destructive mt-0.5 inline-block rounded border px-1.5 text-sm font-semibold">
                              {t("overLimit")}
                            </span>
                          )}
                        </div>
                        <span className="text-destructive shrink-0 text-base font-semibold tabular-nums">
                          {formatVND(o.balance)}
                        </span>
                        {unread && (
                          <span
                            className="bg-primary h-2.5 w-2.5 shrink-0 rounded-full"
                            aria-label={t("unread")}
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Link
              href="/admin/notifications"
              onClick={() => setOpen(false)}
              className="text-primary flex min-h-11 items-center justify-center rounded-lg text-base font-medium"
            >
              {t("viewAll")}
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
