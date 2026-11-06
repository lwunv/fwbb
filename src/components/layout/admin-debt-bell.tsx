"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

/**
 * Lấy lại tối đa 5 phút một lần. KHÔNG đặt trong layout server: các trang
 * admin tự `router.refresh()` theo nhịp, mỗi lần chạy lại layout là quét cả
 * sổ cái (từng làm hết hạn mức Turso, xem HEAVY_POLL_MS).
 */
const STALE_MS = 5 * 60_000;

export const ADMIN_DEBT_QUERY_KEY = ["admin-debt-notifications"] as const;

/**
 * Chuông cạnh logo Admin (yêu cầu user 6/11/2026). Số đỏ = mọi member trong
 * quỹ đang âm. Bấm mở danh sách nhanh (bottom sheet), link sang trang thông
 * báo đầy đủ có lịch sử. Khi N1 (thông báo đầy đủ) lên prod thì chuông N1 thay
 * chỗ này.
 */
export function AdminDebtBell({ className }: { className?: string }) {
  const t = useTranslations("adminNotifications");
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: ADMIN_DEBT_QUERY_KEY,
    queryFn: () => getAdminDebtNotifications(),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
  });

  const result = data && !("error" in data) ? data : null;
  const owing = result?.owing ?? [];
  const count = owing.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto flex max-h-[80dvh] w-full max-w-lg flex-col gap-0 overflow-hidden p-0"
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
              <p className="text-destructive py-4 text-center text-base">
                {t("loadError")}
              </p>
            ) : owing.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-base">
                {t("empty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {owing.map((o) => (
                  <li
                    key={o.memberId}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2"
                  >
                    <span className="min-w-0 truncate text-base" title={o.name}>
                      {o.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {o.overLimit && (
                        <span className="border-destructive/40 bg-destructive/10 text-destructive rounded border px-1.5 text-sm font-semibold">
                          {t("overLimit")}
                        </span>
                      )}
                      <span className="text-destructive text-base font-semibold tabular-nums">
                        {formatVND(o.balance)}
                      </span>
                    </span>
                  </li>
                ))}
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
