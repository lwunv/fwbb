"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
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
import { logout } from "@/actions/auth";
import { LanguageSelector } from "@/components/shared/language-selector";
import { ThemeToggle } from "@/components/shared/theme-toggle";

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

export function AdminSidebar({ appName = "FWBB" }: { appName?: string }) {
  const pathname = usePathname();
  const t = useTranslations("adminNav");

  return (
    <aside className="bg-card hidden border-r lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col">
      <div className="flex items-center gap-2 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fwbb.svg" alt={appName} className="h-8 w-auto" />
        <h1 className="text-xl font-bold">{appName} Admin</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          // Exact match cho /admin/fund (tránh match nhầm khi đang ở
          // /admin/fund/transactions); các href khác dùng startsWith như cũ.
          const isActive =
            item.href === "/admin/fund"
              ? pathname === "/admin/fund"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-2 border-t p-3">
        <div className="flex items-center gap-2 px-1">
          <LanguageSelector className="flex-1" />
          <ThemeToggle />
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("logout")}
          </button>
        </form>
      </div>
    </aside>
  );
}
