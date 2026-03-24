"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-card">
      <div className="p-6">
        <h1 className="text-xl font-bold">FWBB Admin</h1>
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
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t">
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full hover:bg-accent transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Dang xuat
          </button>
        </form>
      </div>
    </aside>
  );
}
