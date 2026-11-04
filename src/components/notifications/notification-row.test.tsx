// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { NotificationView } from "@/lib/notifications/render";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { NotificationRow } = await import("./notification-row");

beforeEach(() => vi.stubGlobal("open", vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  id: 1,
  entityType: "session" as const,
  entityId: 12,
  mandatory: false,
  readAt: null,
  createdAt: "2026-11-04T10:00:00.000Z",
};

function renderRow(
  item: Pick<NotificationView, "kind" | "payload">,
  scope: "member" | "admin",
) {
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <NotificationRow
        item={{ ...base, ...item } as NotificationView}
        scope={scope}
        zaloGroupUrl="https://zalo.me/g/abc"
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

const shareButton = () =>
  screen.queryByRole("button", { name: viMessages.notifications.share.label });

describe("NotificationRow share slot", () => {
  it("admin row for unvoted_before_deadline renders a share button whose text lists the payload names", async () => {
    const writeText = stubClipboard();
    renderRow(
      {
        kind: "unvoted_before_deadline",
        payload: {
          sessionDate: "2026-11-06",
          startTime: "20:30",
          voteDeadline: "2026-11-06T12:00:00.000Z",
          names: ["An", "Bình"],
        },
      },
      "admin",
    );
    fireEvent.click(shareButton()!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain("An, Bình");
  });

  it("low_attendance share text carries the session link built from entityId", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.test");
    const writeText = stubClipboard();
    renderRow(
      {
        kind: "low_attendance",
        payload: {
          sessionDate: "2026-11-06",
          startTime: "20:30",
          headcount: 7,
          maxPlayers: 16,
        },
      },
      "admin",
    );
    fireEvent.click(shareButton()!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toContain(
      "https://fwbb.test/vote/12",
    );
    vi.unstubAllEnvs();
  });

  it("clicking the share button does not select the row", () => {
    stubClipboard();
    const onSelect = renderRow(
      {
        kind: "low_attendance",
        payload: {
          sessionDate: "2026-11-06",
          startTime: "20:30",
          headcount: 7,
          maxPlayers: 16,
        },
      },
      "admin",
    );
    fireEvent.click(shareButton()!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("member rows never show a share button", () => {
    renderRow(
      {
        kind: "unvoted_before_deadline",
        payload: {
          sessionDate: "2026-11-06",
          startTime: "20:30",
          voteDeadline: null,
          names: ["An"],
        },
      },
      "member",
    );
    expect(shareButton()).toBeNull();
  });
});
