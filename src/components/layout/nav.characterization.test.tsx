// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/actions/auth", () => ({ logout: vi.fn() }));
vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => null,
}));
vi.mock("@/components/shared/language-selector", () => ({
  LanguageSelector: () => null,
}));
vi.mock("@/components/tour/use-product-tour", () => ({
  useProductTour: () => ({ run: vi.fn(), hasSeen: () => true }),
}));

const { NavDrawer } = await import("./nav-drawer");
const { AdminSidebar } = await import("./admin-sidebar");
const { AdminMobileNav } = await import("./admin-mobile-nav");

afterEach(cleanup);

function renderVi(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** [href, nhãn] của mọi link trong thẻ <nav>, theo thứ tự hiển thị. */
function navLinks(): [string | null, string | null][] {
  const nav = screen.getByRole("navigation");
  return Array.from(nav.querySelectorAll("a")).map((a) => [
    a.getAttribute("href"),
    a.textContent,
  ]);
}

const ADMIN_LINKS = [
  ["/admin/dashboard", "Tổng quan"],
  ["/admin/sessions", "Buổi chơi"],
  ["/admin/members", "Thành viên"],
  ["/admin/courts", "Sân"],
  ["/admin/venues", "Danh bạ sân"],
  ["/admin/shuttlecocks", "Hãng cầu"],
  ["/admin/inventory", "Tồn kho"],
  ["/admin/fund", "Quỹ"],
  ["/admin/fund/transactions", "Quản lý giao dịch"],
  ["/admin/court-rent", "Tiền sân"],
  ["/admin/shuttlecock-finance", "Tiền cầu"],
  ["/admin/stats", "Thống kê"],
  ["/admin/account", "Tài khoản"],
  ["/admin/settings", "Cài đặt"],
];

describe("navigation links", () => {
  it("group nav drawer, exchange nav drawer, admin sidebar and admin mobile nav show the current hrefs", async () => {
    // Ngăn kéo nhóm
    const group = renderVi(<NavDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "Mở menu" }));
    await screen.findByRole("navigation");
    expect(navLinks()).toEqual([
      ["/", "Trang chủ"],
      ["/history", "Lịch sử"],
      ["/my-fund", "Quỹ"],
      ["/stats", "Thống kê"],
      ["/san", "Sân"],
      ["/me", "Cá nhân"],
    ]);
    group.unmount();
    cleanup();

    // Ngăn kéo giao lưu
    const exchange = renderVi(<NavDrawer navItems="exchange" />);
    fireEvent.click(screen.getByRole("button", { name: "Mở menu" }));
    await screen.findByRole("navigation");
    expect(navLinks()).toEqual([
      ["/giao-luu", "Giao lưu"],
      ["/san", "Sân"],
    ]);
    exchange.unmount();
    cleanup();

    // Sidebar admin
    const side = renderVi(<AdminSidebar />);
    expect(navLinks()).toEqual(ADMIN_LINKS);
    side.unmount();
    cleanup();

    // Menu admin trên di động
    renderVi(<AdminMobileNav />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    await screen.findByRole("navigation");
    expect(navLinks()).toEqual(ADMIN_LINKS);
  });
});
