"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Menu,
  LayoutDashboard,
  Calendar,
  Users,
  MapPin,
  CircleDot,
  Package,
  Wallet,
  BarChart3,
  LogOut,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { logout } from "@/actions/auth";
import { LanguageSelector } from "@/components/shared/language-selector";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NavPendingIcon } from "./nav-pending-icon";

const navItems = [
  {
    href: "/admin/dashboard",
    labelKey: "dashboard" as const,
    icon: LayoutDashboard,
  },
  { href: "/admin/sessions", labelKey: "sessions" as const, icon: Calendar },
  { href: "/admin/members", labelKey: "members" as const, icon: Users },
  { href: "/admin/courts", labelKey: "courts" as const, icon: MapPin },
  {
    href: "/admin/shuttlecocks",
    labelKey: "shuttlecocks" as const,
    icon: CircleDot,
  },
  { href: "/admin/inventory", labelKey: "inventory" as const, icon: Package },
  { href: "/admin/fund", labelKey: "fund" as const, icon: Wallet },
  {
    href: "/admin/fund/transactions",
    labelKey: "transactions" as const,
    icon: Receipt,
  },
  {
    href: "/admin/court-rent",
    labelKey: "courtRent" as const,
    icon: MapPin,
  },
  {
    href: "/admin/shuttlecock-finance",
    labelKey: "shuttlecockFinance" as const,
    icon: CircleDot,
  },
  { href: "/admin/stats", labelKey: "stats" as const, icon: BarChart3 },
];

export function AdminMobileNav({
  appName = "FWBB",
  pendingMemberCount = 0,
}: {
  appName?: string;
  pendingMemberCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useTranslations("adminNav");

  return (
    <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex items-center justify-between border-b p-4 lg:hidden">
      <div className="flex items-center gap-2">
        <Link href="/admin/dashboard" className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fwbb.svg" alt={appName} className="h-7 w-auto" />
        </Link>
        <h1 className="text-lg font-bold">{appName} Admin</h1>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" />}>
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <div className="flex items-center gap-2 border-b p-6">
            <Link
              href="/admin/dashboard"
              onClick={() => setOpen(false)}
              className="inline-flex items-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fwbb.svg" alt={appName} className="h-8 w-auto" />
            </Link>
            <h2 className="text-lg font-bold">{appName} Admin</h2>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const isActive =
                item.href === "/admin/fund"
                  ? pathname === "/admin/fund"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  <NavPendingIcon Icon={item.icon} className="h-4 w-4" />
                  <span className="flex-1">{t(item.labelKey)}</span>
                  {item.labelKey === "members" && pendingMemberCount > 0 && (
                    <span
                      className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white"
                      title={t("pendingMembersTitle")}
                    >
                      {pendingMemberCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          {pendingMemberCount > 0 && (
            <div className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              ⚠ {t("pendingMembersBanner", { count: pendingMemberCount })}
            </div>
          )}
          <div className="space-y-2 border-t p-3">
            <div className="flex items-center gap-2 px-1">
              <LanguageSelector className="flex-1" />
              <ThemeToggle />
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="hover:bg-accent flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
              >
                <LogOut className="h-4 w-4" />
                {t("logout")}
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
