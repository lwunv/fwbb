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
  DollarSign,
  BarChart3,
  LogOut,
} from "lucide-react";
import { logout } from "@/actions/auth";
import { LanguageSelector } from "@/components/shared/language-selector";
import { ThemeToggle } from "@/components/shared/theme-toggle";

const navItems = [
  { href: "/admin/dashboard", labelKey: "dashboard" as const, icon: LayoutDashboard },
  { href: "/admin/sessions", labelKey: "sessions" as const, icon: Calendar },
  { href: "/admin/members", labelKey: "members" as const, icon: Users },
  { href: "/admin/courts", labelKey: "courts" as const, icon: MapPin },
  { href: "/admin/shuttlecocks", labelKey: "shuttlecocks" as const, icon: CircleDot },
  { href: "/admin/inventory", labelKey: "inventory" as const, icon: Package },
  { href: "/admin/finance", labelKey: "finance" as const, icon: DollarSign },
  { href: "/admin/stats", labelKey: "stats" as const, icon: BarChart3 },
];

export function AdminSidebar({ appName = "FWBB" }: { appName?: string }) {
  const pathname = usePathname();
  const t = useTranslations("adminNav");

  return (
    <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-card">
      <div className="p-6">
        <h1 className="text-xl font-bold">{appName} Admin</h1>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            <item.icon className="h-4 w-4" />
            {t(item.labelKey)}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t space-y-2">
        <div className="flex items-center gap-2 px-1">
          <LanguageSelector className="flex-1" />
          <ThemeToggle />
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full hover:bg-accent transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("logout")}
          </button>
        </form>
      </div>
    </aside>
  );
}
