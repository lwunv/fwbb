// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/actions/notifications", () => ({
  getMyNotificationPrefs: vi.fn(async () => ({
    mutedGroups: [],
    emailEnabled: true,
    email: null,
    emailVerified: false,
  })),
  updateMyNotificationPrefs: vi.fn(),
  requestNotifyEmailVerification: vi.fn(),
}));

const { NotificationPrefsSection } =
  await import("./notification-prefs-section");

afterEach(cleanup);

describe("NotificationPrefsSection groups", () => {
  it("prefs section lists exactly session, money, account, venue for a member", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <NuqsTestingAdapter>
        <QueryClientProvider client={qc}>
          <NextIntlClientProvider locale="vi" messages={viMessages}>
            <NotificationPrefsSection scope="member" />
          </NextIntlClientProvider>
        </QueryClientProvider>
      </NuqsTestingAdapter>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(viMessages.notifications.prefs.title),
      }),
    );
    await screen.findByRole("switch", { name: "Buổi chơi" });
    const labels = screen
      .getAllByRole("switch")
      .map((s) => s.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Buổi chơi",
      "Tiền và quỹ",
      "Tài khoản",
      "Sân mình đề xuất",
    ]);
  });
});
