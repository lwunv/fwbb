import { describe, it, expect } from "vitest";
import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS } from "./catalog";

type Bundle = {
  notifications: { kinds: Record<string, { title?: string; body?: string }> };
};

describe("catalog", () => {
  it("every kind has vi/en/zh title and body", () => {
    for (const [name, bundle] of [
      ["vi", vi],
      ["en", en],
      ["zh", zh],
    ] as const) {
      const kinds = (bundle as unknown as Bundle).notifications.kinds;
      for (const kind of [...NOTIFICATION_KINDS, "unknown"]) {
        expect(kinds[kind]?.title, `${name}.${kind}.title`).toBeTruthy();
        expect(kinds[kind]?.body, `${name}.${kind}.body`).toBeTruthy();
      }
    }
  });

  it("mandatory kinds match spec", () => {
    // Kind giao lưu có bảng riêng ở test bên dưới; danh sách này giữ nguyên.
    const mandatory = NOTIFICATION_KINDS.filter(
      (k) => !k.startsWith("exchange_") && NOTIFICATION_CATALOG[k].mandatory,
    ).sort();
    expect(mandatory).toEqual(
      [
        "vote_edited_by_admin",
        "session_changed",
        "session_cancelled",
        "session_reopened",
        "session_finalized",
        "session_amount_changed",
        "session_deleted_refund",
        "payment_confirmed",
        "payment_undone",
        "transaction_reversed",
        "fund_contribution_recorded",
        "fund_refund_recorded",
        "debt_reminder",
        "account_approved",
        "account_rejected",
        "group_request_declined",
        "account_merged",
        "password_changed",
        "login_method_linked",
        "login_method_unlinked",
        "capacity_alert",
        "low_attendance",
        "venue_pending",
        "reconcile_failed",
      ].sort(),
    );
  });

  it("only the same-day schedule changes bypass quiet hours", () => {
    const bypass = NOTIFICATION_KINDS.filter(
      (k) =>
        !k.startsWith("exchange_") &&
        NOTIFICATION_CATALOG[k].quietHoursBypassSameDay,
    ).sort();
    expect(bypass).toEqual(["session_cancelled", "session_changed"]);
  });

  it("catalog: every exchange kind has vi/en/zh title and body", () => {
    const exchange = NOTIFICATION_KINDS.filter((k) =>
      k.startsWith("exchange_"),
    );
    expect(exchange).toHaveLength(11);
    for (const bundle of [vi, en, zh]) {
      const kinds = (bundle as unknown as Bundle).notifications.kinds;
      for (const kind of exchange) {
        expect(kinds[kind]?.title, `${kind}.title`).toBeTruthy();
        expect(kinds[kind]?.body, `${kind}.body`).toBeTruthy();
      }
    }
  });

  it("exchange kinds follow the declared mandatory/email/level/audience table", () => {
    const row = (k: (typeof NOTIFICATION_KINDS)[number]) => {
      const d = NOTIFICATION_CATALOG[k];
      return [
        d.audience,
        d.group,
        d.mandatory,
        d.email,
        d.level,
        d.quietHoursBypassSameDay,
      ];
    };
    expect(row("exchange_registration_received")).toEqual([
      "member",
      "exchange",
      false,
      false,
      "now",
      false,
    ]);
    expect(row("exchange_registration_cancelled")).toEqual([
      "member",
      "exchange",
      false,
      false,
      "now",
      false,
    ]);
    expect(row("exchange_cancelled_after_lock")).toEqual([
      "member",
      "exchange",
      true,
      false,
      "now",
      false,
    ]);
    expect(row("exchange_registration_approved")).toEqual([
      "member",
      "exchange",
      true,
      true,
      "now",
      false,
    ]);
    expect(row("exchange_registration_rejected")).toEqual([
      "member",
      "exchange",
      true,
      false,
      "now",
      false,
    ]);
    expect(row("exchange_waitlist_promoted")).toEqual([
      "member",
      "exchange",
      true,
      true,
      "now",
      false,
    ]);
    expect(row("exchange_fee_locked")).toEqual([
      "member",
      "exchange",
      true,
      true,
      "now",
      false,
    ]);
    expect(row("exchange_fee_changed")).toEqual([
      "member",
      "exchange",
      true,
      true,
      "now",
      false,
    ]);
    expect(row("exchange_event_cancelled")).toEqual([
      "member",
      "exchange",
      true,
      true,
      "now",
      true,
    ]);
    expect(row("exchange_event_hidden")).toEqual([
      "member",
      "exchange",
      true,
      false,
      "now",
      false,
    ]);
    expect(row("exchange_reported")).toEqual([
      "admin",
      "admin_members",
      false,
      false,
      "now",
      false,
    ]);
  });
});
