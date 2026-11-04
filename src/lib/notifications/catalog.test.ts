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
    const mandatory = NOTIFICATION_KINDS.filter(
      (k) => NOTIFICATION_CATALOG[k].mandatory,
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
      (k) => NOTIFICATION_CATALOG[k].quietHoursBypassSameDay,
    ).sort();
    expect(bypass).toEqual(["session_cancelled", "session_changed"]);
  });
});
