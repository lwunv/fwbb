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
  DollarSign,
  Wallet,
  BarChart3,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
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
  { href: "/admin/finance", labelKey: "finance" as const, icon: DollarSign },
  { href: "/admin/fund", labelKey: "fund" as const, icon: Wallet },
  { href: "/admin/stats", labelKey: "stats" as const, icon: BarChart3 },
];

export function AdminMobileNav({ appName = "FWBB" }: { appName?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useTranslations("adminNav");

  return (
    <div className="bg-card flex items-center justify-between border-b p-4 lg:hidden">
      <h1 className="text-lg font-bold">{appName} Admin</h1>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" />}>
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <div className="border-b p-6">
            <h2 className="text-lg font-bold">{appName} Admin</h2>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
          <div className="space-y-2 border-t p-3">
            <div className="flex items-center gap-2 px-1">
              <LanguageSelector className="flex-1" />
              <ThemeToggle />
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
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
