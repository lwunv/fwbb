// @vitest-environment jsdom
/**
 * Số sân chờ duyệt trên khung admin: huy hiệu ở mục Danh bạ sân (sidebar và
 * menu di động), thêm dòng nhắc trên di động. Số 0 thì giao diện y như cũ.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/dashboard",
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

const { AdminSidebar } = await import("./admin-sidebar");
const { AdminMobileNav } = await import("./admin-mobile-nav");

const venuesLabel = viMessages.adminNav.venues;
const membersLabel = viMessages.adminNav.members;

function renderVi(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function venuesLink() {
  return screen.getByRole("link", { name: new RegExp(venuesLabel) });
}

afterEach(cleanup);

describe("AdminSidebar", () => {
  it("hiện số sân chờ duyệt ở mục Danh bạ sân khi N > 0", () => {
    renderVi(<AdminSidebar pendingVenueCount={3} />);
    expect(venuesLink().textContent).toContain("3");
  });

  it("không hiện huy hiệu khi N = 0 hoặc không truyền", () => {
    const { unmount } = renderVi(<AdminSidebar pendingVenueCount={0} />);
    expect(venuesLink().textContent).toBe(venuesLabel);
    unmount();
    renderVi(<AdminSidebar />);
    expect(venuesLink().textContent).toBe(venuesLabel);
  });

  it("số thành viên chờ duyệt vẫn ở mục Thành viên, không lẫn sang sân", () => {
    renderVi(<AdminSidebar pendingMemberCount={2} pendingVenueCount={0} />);
    expect(
      screen.getByRole("link", { name: new RegExp(membersLabel) }).textContent,
    ).toContain("2");
    expect(venuesLink().textContent).toBe(venuesLabel);
  });
});

describe("AdminMobileNav", () => {
  function openMenu() {
    fireEvent.click(screen.getAllByRole("button")[0]);
  }
  const bannerText = (n: number) =>
    viMessages.adminNav.pendingVenuesBanner.replace("{count}", String(n));

  it("hiện huy hiệu và dòng nhắc dẫn tới /admin/venues khi N > 0", async () => {
    renderVi(<AdminMobileNav pendingVenueCount={4} />);
    openMenu();
    expect(
      (await screen.findByRole("link", { name: new RegExp(venuesLabel) }))
        .textContent,
    ).toContain("4");
    const banner = await screen.findByRole("link", {
      name: new RegExp(bannerText(4)),
    });
    expect(banner.getAttribute("href")).toBe("/admin/venues");
  });

  it("không hiện huy hiệu hay dòng nhắc khi N = 0", async () => {
    renderVi(<AdminMobileNav pendingVenueCount={0} />);
    openMenu();
    const link = await screen.findByRole("link", {
      name: new RegExp(venuesLabel),
    });
    expect(link.textContent).toBe(venuesLabel);
    expect(screen.queryByText(new RegExp(bannerText(0)))).toBeNull();
    expect(screen.queryByText(/sân chờ duyệt/)).toBeNull();
  });
});
