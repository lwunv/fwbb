"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { LanguageSelector } from "@/components/shared/language-selector";
import { NavDrawer } from "@/components/layout/nav-drawer";
import { Button } from "@/components/ui/button";

export function Header({
  appName = "FWBB",
  showLogin = false,
  showMenu = false,
}: {
  appName?: string;
  /** Hiện nút "Đăng nhập" — dùng ở shell khách chưa đăng nhập (trang chủ public). */
  showLogin?: boolean;
  /** Hiện nút menu hamburger (ngăn kéo điều hướng trái) — nhánh member đã duyệt. */
  showMenu?: boolean;
}) {
  const t = useTranslations("publicLayout");
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-1">
          {showMenu && <NavDrawer />}
          <Link href="/" className="flex min-w-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fwbb.svg"
              alt={appName}
              className="h-8 w-auto shrink-0"
            />
            <span className="truncate text-lg font-bold">{appName}</span>
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSelector />
          <ThemeToggle />
          {showLogin && (
            <Button size="sm" className="ml-1" render={<Link href="/login" />}>
              <LogIn className="mr-1.5 h-4 w-4" />
              {t("loginButton")}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
