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
  BarChart3,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { logout } from "@/actions/auth";

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

export function AdminMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useTranslations("adminNav");

  return (
    <div className="lg:hidden flex items-center justify-between p-4 border-b bg-card">
      <h1 className="text-lg font-bold">FWBB Admin</h1>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={<Button variant="ghost" size="icon" />}
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <div className="p-6 border-b">
            <h2 className="text-lg font-bold">FWBB Admin</h2>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
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
          <div className="p-3 border-t">
            <form action={logout}>
              <button
                type="submit"
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full hover:bg-accent"
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
