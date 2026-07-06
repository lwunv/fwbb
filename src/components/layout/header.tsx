"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { LanguageSelector } from "@/components/shared/language-selector";
import { Button } from "@/components/ui/button";

export function Header({
  appName = "FWBB",
  showLogin = false,
}: {
  appName?: string;
  /** Hiện nút "Đăng nhập" — dùng ở shell khách chưa đăng nhập (trang chủ public). */
  showLogin?: boolean;
}) {
  const t = useTranslations("publicLayout");
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fwbb.svg" alt={appName} className="h-8 w-auto" />
          <span className="text-lg font-bold">{appName}</span>
        </Link>
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
