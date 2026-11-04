"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/lib/use-is-mobile";
import { NotificationPanel } from "./notification-panel";
import { useUnreadCount, type NotificationScope } from "./use-notifications";

/** Chuông thông báo: chấm đếm chưa đọc + panel (sheet dưới ở mobile, dialog từ `sm:`). */
export function NotificationBell({ scope }: { scope: NotificationScope }) {
  const t = useTranslations("notifications.bell");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useUnreadCount(scope);
  const label = unread >= 100 ? "99+" : String(unread);

  const panel = (
    <NotificationPanel scope={scope} onNavigate={() => setOpen(false)} />
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          unread > 0
            ? `${t("title")}, ${t("unreadCount", { count: unread })}`
            : t("title")
        }
        className="hover:bg-accent text-foreground relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="bg-destructive absolute top-1 right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold text-white"
          >
            {label}
          </span>
        )}
      </button>
      {isMobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85vh] rounded-t-2xl p-4"
          >
            <SheetHeader className="p-0">
              <SheetTitle className="text-lg">{t("title")}</SheetTitle>
            </SheetHeader>
            {open && panel}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg">{t("title")}</DialogTitle>
            </DialogHeader>
            {open && panel}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
