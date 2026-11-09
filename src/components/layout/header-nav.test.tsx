// @vitest-environment jsdom
/**
 * Header + NavDrawer sau g2a Task 10: mặc định giữ nguyên hành vi cũ, vùng
 * giao lưu có trang đăng nhập riêng (kèm ?next=), menu giao lưu chỉ 2 mục, và
 * ý định mở tour sống qua sessionStorage khi đổi layout /venues → /.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
const tour = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => null,
}));
vi.mock("@/components/shared/language-selector", () => ({
  LanguageSelector: () => null,
}));
vi.mock("@/components/tour/use-product-tour", () => ({
  useProductTour: () => ({ run: tour.run, hasSeen: () => true }),
}));

const { Header } = await import("./header");
const { NavDrawer } = await import("./nav-drawer");

function renderVi(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const loginName = viMessages.publicLayout.loginButton;
const hrefOf = (name: RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  nav.pathname = "/";
  nav.push.mockClear();
  tour.run.mockClear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Header", () => {
  it("mặc định: nút đăng nhập trỏ /login (không ?next), logo về /", () => {
    nav.pathname = "/venues";
    renderVi(<Header appName="FWBB" showLogin />);
    expect(hrefOf(new RegExp(loginName))).toBe("/login");
    expect(hrefOf(/FWBB/)).toBe("/");
  });

  it("loginHref riêng: gắn ?next=<trang hiện tại>", () => {
    nav.pathname = "/venues/12";
    renderVi(<Header appName="FWBB" showLogin loginHref="/exchanges/login" />);
    expect(hrefOf(new RegExp(loginName))).toBe(
      "/exchanges/login?next=%2Fvenues%2F12",
    );
  });

  it("loginHref riêng: đang ở chính trang đăng nhập thì ẩn nút", () => {
    nav.pathname = "/exchanges/login";
    renderVi(<Header appName="FWBB" showLogin loginHref="/exchanges/login" />);
    expect(
      screen.queryByRole("link", { name: new RegExp(loginName) }),
    ).toBeNull();
  });

  it("homeHref đổi đích của logo", () => {
    renderVi(<Header appName="FWBB" homeHref="/exchanges" />);
    expect(hrefOf(/FWBB/)).toBe("/exchanges");
  });
});

describe("NavDrawer", () => {
  function openMenu() {
    fireEvent.click(screen.getByRole("button", { name: viMessages.nav.menu }));
  }

  it("exchange: chỉ Giao lưu và Sân, không có Hướng dẫn", () => {
    nav.pathname = "/venues";
    renderVi(<NavDrawer navItems="exchange" />);
    openMenu();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    // Ruling R18 (spec 4.6b): tài khoản giao lưu có thêm "Cá nhân".
    expect(hrefs).toEqual(["/exchanges", "/venues", "/exchanges/mine"]);
    expect(screen.getByText(viMessages.nav.exchange)).not.toBeNull();
    expect(screen.queryByText(viMessages.tour.open)).toBeNull();
  });

  it("group: đủ mục nhóm và có Hướng dẫn", () => {
    renderVi(<NavDrawer />);
    openMenu();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/",
      "/history",
      "/my-fund",
      "/stats",
      "/venues",
      "/me",
    ]);
    expect(screen.getByText(viMessages.tour.open)).not.toBeNull();
  });

  it("bấm Hướng dẫn ở /venues → ghi cờ sessionStorage và về /", () => {
    nav.pathname = "/venues";
    renderVi(<NavDrawer />);
    openMenu();
    fireEvent.click(screen.getByText(viMessages.tour.open));
    expect(sessionStorage.getItem("fwbb:tourPending")).toBe("1");
    expect(nav.push).toHaveBeenCalledWith("/");
  });

  it("mount ở / với cờ → chạy tour sau 800 ms rồi xoá cờ", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("fwbb:tourPending", "1");
    renderVi(<NavDrawer />);
    act(() => vi.advanceTimersByTime(799));
    expect(tour.run).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(tour.run).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("fwbb:tourPending")).toBeNull();
  });

  it("menu exchange ở / không đọc cờ tour", () => {
    vi.useFakeTimers();
    sessionStorage.setItem("fwbb:tourPending", "1");
    renderVi(<NavDrawer navItems="exchange" />);
    act(() => vi.advanceTimersByTime(2000));
    expect(tour.run).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("fwbb:tourPending")).toBe("1");
  });

  it("sessionStorage ném lỗi → vẫn về / và không vỡ", () => {
    nav.pathname = "/venues";
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderVi(<NavDrawer />);
    openMenu();
    fireEvent.click(screen.getByText(viMessages.tour.open));
    expect(nav.push).toHaveBeenCalledWith("/");
  });
});
