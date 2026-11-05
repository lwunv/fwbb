// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("next/navigation", () => ({
  usePathname: () => "/giao-luu/cua-toi",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/tour/use-product-tour", () => ({
  useProductTour: () => ({ run: vi.fn(), hasSeen: () => true }),
}));

const { NavDrawer } = await import("./nav-drawer");

afterEach(cleanup);

async function links(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mở menu" }));
  const nav = await screen.findByRole("navigation");
  return Array.from(nav.querySelectorAll("a")).map((a) => [
    a.getAttribute("href"),
    a.textContent,
  ]);
}

describe("nav entries for the exchange feature", () => {
  it("group nav shows Giao lưu only when the flag is on", async () => {
    const on = await links(<NavDrawer exchangeEnabled />);
    expect(on).toEqual([
      ["/", "Trang chủ"],
      ["/history", "Lịch sử"],
      ["/my-fund", "Quỹ"],
      ["/stats", "Thống kê"],
      ["/san", "Sân"],
      ["/giao-luu", "Giao lưu"],
      ["/me", "Cá nhân"],
    ]);
    cleanup();
    const off = await links(<NavDrawer />);
    expect(off.map((l) => l[0])).not.toContain("/giao-luu");
  });

  it("exchange nav shows Cá nhân", async () => {
    expect(await links(<NavDrawer navItems="exchange" />)).toEqual([
      ["/giao-luu", "Giao lưu"],
      ["/san", "Sân"],
      ["/giao-luu/cua-toi", "Cá nhân"],
    ]);
  });

  it("only the matching exchange entry is active on /giao-luu/cua-toi", async () => {
    await links(<NavDrawer navItems="exchange" />);
    const nav = screen.getByRole("navigation");
    const active = Array.from(nav.querySelectorAll("a"))
      .filter((a) => a.className.includes("text-primary"))
      .map((a) => a.getAttribute("href"));
    expect(active).toEqual(["/giao-luu/cua-toi"]);
  });
});
