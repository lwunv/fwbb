"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { LanguageSelector } from "@/components/shared/language-selector";
import { NavDrawer } from "@/components/layout/nav-drawer";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { safeNextPath } from "@/lib/safe-next-path";

const DEFAULT_LOGIN_HREF = "/login";

export function Header({
  appName = "FWBB",
  showLogin = false,
  showMenu = false,
  loginHref = DEFAULT_LOGIN_HREF,
  homeHref = "/",
  navItems = "group",
  showBell = false,
  exchangeEnabled = false,
}: {
  appName?: string;
  /** Hiện nút "Đăng nhập" — dùng ở shell khách chưa đăng nhập (trang chủ public). */
  showLogin?: boolean;
  /** Hiện nút menu hamburger (ngăn kéo điều hướng trái) — nhánh member đã duyệt. */
  showMenu?: boolean;
  /**
   * Trang đăng nhập của nút "Đăng nhập". Khác mặc định (vùng giao lưu) thì gắn
   * `?next=<trang hiện tại>` để đăng nhập xong quay lại, và ẩn nút khi đang
   * đứng ngay trang đăng nhập đó.
   */
  loginHref?: string;
  /** Đích của logo. Vùng giao lưu dùng "/giao-luu" thay trang chủ nhóm. */
  homeHref?: string;
  /** Bộ mục menu của ngăn kéo (xem NavDrawer). */
  navItems?: "group" | "exchange";
  /** Chuông thông báo của member (công tắc notificationsEnabled đang bật). */
  showBell?: boolean;
  /** Cờ giao lưu bật: ngăn kéo nhóm có thêm mục "Giao lưu". */
  exchangeEnabled?: boolean;
}) {
  const t = useTranslations("publicLayout");
  const pathname = usePathname();
  const customLogin = loginHref !== DEFAULT_LOGIN_HREF;
  const loginLink = customLogin
    ? `${loginHref}?next=${encodeURIComponent(safeNextPath(pathname))}`
    : loginHref;
  const loginVisible = showLogin && !(customLogin && pathname === loginHref);
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-1">
          {showMenu && (
            <NavDrawer navItems={navItems} exchangeEnabled={exchangeEnabled} />
          )}
          <Link href={homeHref} className="flex min-w-0 items-center">
            {/* Logo monogram FWB (nền trong suốt), asset riêng cho header; các
                chỗ khác (login, nav, sidebar) dùng badge tròn /fwbb.svg. Không
                kèm chữ "FWBB" (logo đã là nhận diện). Hai bản theo theme: bản
                ĐEN cho light + pink (nền sáng), bản HỒNG cho dark (nền tối).
                Toggle bằng class `.dark` của next-themes; đúng một bản hiện mỗi
                lúc nên screen reader chỉ đọc một `alt`. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fwbb-wordmark-black.svg"
              alt={appName}
              className="h-8 w-auto shrink-0 dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/fwbb-wordmark.svg"
              alt={appName}
              className="hidden h-8 w-auto shrink-0 dark:block"
            />
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {/* Chuông nằm NGOÀI khung tour: tour trang chủ chỉ khoanh cụm
              ngôn ngữ/giao diện. */}
          {showBell && <NotificationBell scope="member" />}
          <div className="flex items-center gap-1" data-tour="header-prefs">
            <LanguageSelector />
            <ThemeToggle />
            {loginVisible && (
              <Button
                size="sm"
                className="ml-1"
                render={<Link href={loginLink} />}
              >
                <LogIn className="mr-1.5 h-4 w-4" />
                {t("loginButton")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
