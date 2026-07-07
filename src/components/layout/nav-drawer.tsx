"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Home,
  Clock,
  Wallet,
  BarChart3,
  User,
  Menu,
  HelpCircle,
} from "lucide-react";
import { NavPendingIcon } from "./nav-pending-icon";
import { useProductTour } from "@/components/tour/use-product-tour";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const navItems = [
  { href: "/", labelKey: "home" as const, icon: Home, tour: "nav-home" },
  {
    href: "/history",
    labelKey: "history" as const,
    icon: Clock,
    tour: "nav-history",
  },
  {
    href: "/my-fund",
    labelKey: "fund" as const,
    icon: Wallet,
    tour: "nav-fund",
  },
  {
    href: "/stats",
    labelKey: "stats" as const,
    icon: BarChart3,
    tour: "nav-stats",
  },
  { href: "/me", labelKey: "me" as const, icon: User, tour: "nav-me" },
];

/**
 * Điều hướng dạng ngăn kéo trái (hamburger) — thay bottom-nav để nhường đáy
 * màn hình cho thanh vote sticky. Nút hamburger nằm góc trái Header; bấm mở
 * Sheet trượt từ trái với đủ 5 mục. Chọn mục → đóng ngăn kéo.
 */
export function NavDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tTour = useTranslations("tour");
  const { run, hasSeen } = useProductTour();

  // Auto-chạy tour lần đầu (thay cho nút compass đã bỏ). Chỉ 1 lần/phiên, bỏ
  // qua dưới automation (Playwright: navigator.webdriver=true).
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    if (!hasSeen()) {
      const id = setTimeout(() => run(), 800);
      return () => clearTimeout(id);
    }
  }, [hasSeen, run]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("menu")}
        data-tour="nav-menu"
        className="hover:bg-accent -ml-1 flex h-11 w-11 items-center justify-center rounded-xl transition-colors"
      >
        <Menu className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-0">
          <SheetHeader>
            <SheetTitle>{t("menuTitle")}</SheetTitle>
          </SheetHeader>
          <nav className="space-y-1 px-3 pb-4">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/vote")
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-tour={item.tour}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3 py-3 text-base font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  <NavPendingIcon Icon={item.icon} isActive={isActive} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            })}

            {/* Hướng dẫn (product tour) — cuối menu, thay nút compass đã bỏ. */}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                // Đóng ngăn kéo trước rồi chạy tour để overlay neo đúng trang.
                setTimeout(() => run(), 300);
              }}
              className="text-foreground hover:bg-accent mt-1 flex min-h-12 w-full items-center gap-3 rounded-xl border-t px-3 py-3 text-base font-medium transition-colors"
            >
              <HelpCircle className="text-muted-foreground h-6 w-6 shrink-0" />
              <span>{tTour("open")}</span>
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
