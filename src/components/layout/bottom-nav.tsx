"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Home, Clock, Wallet, BarChart3, User } from "lucide-react";

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

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav className="bg-background/95 supports-[backdrop-filter]:bg-background/60 fixed right-0 bottom-0 left-0 z-40 border-t backdrop-blur">
      <div className="flex h-16 items-center justify-around">
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
              className={cn(
                "flex flex-col items-center gap-1 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon
                className={cn("h-5 w-5", isActive && "text-primary")}
              />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
