"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  { href: "/admin/dashboard", label: "Tong quan", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Buoi choi", icon: Calendar },
  { href: "/admin/members", label: "Thanh vien", icon: Users },
  { href: "/admin/courts", label: "San", icon: MapPin },
  { href: "/admin/shuttlecocks", label: "Hang cau", icon: CircleDot },
  { href: "/admin/inventory", label: "Ton kho", icon: Package },
  { href: "/admin/finance", label: "Tai chinh", icon: DollarSign },
  { href: "/admin/stats", label: "Thong ke", icon: BarChart3 },
];

export function AdminMobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
                {item.label}
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
                Dang xuat
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
