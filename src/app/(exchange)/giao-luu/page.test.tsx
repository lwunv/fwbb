// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import viMessages from "@/i18n/messages/vi.json";

const { viewer } = vi.hoisted(() => ({
  viewer: { current: { status: "anonymous" } as Record<string, unknown> },
}));

vi.mock("@/lib/member-auth", () => ({
  getExchangeViewer: async () => viewer.current,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    const base = (viMessages as Record<string, unknown>)[ns] as Record<
      string,
      string
    >;
    return (k: string) => base[k] ?? k;
  },
}));
vi.mock("./account-card", () => ({
  ExchangeAccountCard: ({ name }: { name: string }) => (
    <div data-testid="account-card">{name}</div>
  ),
}));
vi.mock("./exchange-search", () => ({
  ExchangeSearch: ({ canOpenEvent }: { canOpenEvent: boolean }) => (
    <div data-testid="search" data-can-open={String(canOpenEvent)} />
  ),
}));

import ExchangePage from "./page";

afterEach(cleanup);

describe("/giao-luu page", () => {
  it("page keeps the G2a account card and the guest login CTA", async () => {
    viewer.current = { status: "anonymous" };
    const { unmount } = render(await ExchangePage());
    expect(
      screen.getByRole("link", { name: "Đăng nhập để giao lưu" }),
    ).toBeTruthy();
    expect(screen.getByTestId("search").getAttribute("data-can-open")).toBe(
      "false",
    );
    unmount();

    viewer.current = {
      status: "ok",
      isGroupMember: false,
      member: {
        id: 9,
        name: "Minh",
        avatarUrl: null,
        avatarKey: null,
        signupIntent: "exchange",
      },
    };
    render(await ExchangePage());
    expect(screen.getByTestId("account-card").textContent).toBe("Minh");
    expect(
      screen.queryByRole("link", { name: "Đăng nhập để giao lưu" }),
    ).toBeNull();
  });

  it("approved group members can open events", async () => {
    viewer.current = {
      status: "ok",
      isGroupMember: true,
      member: { id: 1, name: "An" },
    };
    render(await ExchangePage());
    expect(screen.getByTestId("search").getAttribute("data-can-open")).toBe(
      "true",
    );
    expect(screen.queryByTestId("account-card")).toBeNull();
  });
});
