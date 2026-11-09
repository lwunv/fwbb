import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import vi from "@/i18n/messages/vi.json";
import { NOTIFICATION_KINDS, type NotificationKind } from "./catalog";
import {
  notificationHref,
  renderNotification,
  type NotificationView,
  type Translate,
} from "./render";

function view(
  kind: NotificationKind,
  payload: Record<string, unknown> = {},
): NotificationView {
  return {
    id: 1,
    kind,
    entityType: null,
    entityId: 7,
    payload,
    mandatory: false,
    readAt: null,
    createdAt: "2026-11-04T00:00:00.000Z",
  };
}

// [member href, admin href] của từng kind khi entityId = 7. Cứng tay: đổi
// route hay thêm nhánh cho kind cũ phải làm bảng này đỏ.
const HREFS: Record<NotificationKind, [string, string]> = {
  session_opened: ["/vote/7", "/admin/dashboard"],
  vote_due_soon: ["/vote/7", "/admin/dashboard"],
  vote_reopened: ["/vote/7", "/admin/dashboard"],
  vote_edited_by_admin: ["/vote/7", "/admin/dashboard"],
  session_changed: ["/vote/7", "/admin/dashboard"],
  session_cancelled: ["/vote/7", "/admin/dashboard"],
  session_reopened: ["/vote/7", "/admin/dashboard"],
  session_almost_full: ["/vote/7", "/admin/dashboard"],
  game_day_reminder: ["/vote/7", "/admin/dashboard"],
  session_finalized: ["/my-fund", "/admin/dashboard"],
  session_amount_changed: ["/my-fund", "/admin/dashboard"],
  session_deleted_refund: ["/my-fund", "/admin/dashboard"],
  payment_confirmed: ["/my-fund", "/admin/dashboard"],
  payment_undone: ["/my-fund", "/admin/dashboard"],
  transaction_reversed: ["/my-fund", "/admin/dashboard"],
  fund_contribution_recorded: ["/my-fund", "/admin/dashboard"],
  fund_refund_recorded: ["/my-fund", "/admin/dashboard"],
  debt_reminder: ["/my-fund", "/admin/dashboard"],
  account_approved: ["/me", "/admin/dashboard"],
  account_rejected: ["/me", "/admin/dashboard"],
  group_request_declined: ["/me", "/admin/dashboard"],
  account_merged: ["/me", "/admin/dashboard"],
  password_changed: ["/me", "/admin/dashboard"],
  login_method_linked: ["/me", "/admin/dashboard"],
  login_method_unlinked: ["/me", "/admin/dashboard"],
  venue_approved: ["/venues", "/admin/dashboard"],
  venue_hidden: ["/venues", "/admin/dashboard"],
  capacity_alert: ["/", "/admin/sessions/7"],
  low_attendance: ["/", "/admin/sessions/7"],
  member_dropped_late: ["/", "/admin/sessions/7"],
  unvoted_before_deadline: ["/", "/admin/sessions/7"],
  weekly_summary: ["/", "/admin/sessions/7"],
  member_reported_transfer: ["/", "/admin/finance"],
  court_rent_unpaid: ["/", "/admin/court-rent"],
  reconcile_failed: ["/", "/admin/finance"],
  signup_pending: ["/", "/admin/members"],
  group_join_request: ["/", "/admin/members"],
  venue_pending: ["/", "/admin/venues"],
  low_stock: ["/", "/admin/inventory"],
  // Thêm ở G2b Task 6 (payload rỗng nên thiếu eventCode, rơi về /exchanges; link theo mã ở test riêng).
  exchange_registration_received: ["/exchanges", "/admin/dashboard"],
  exchange_registration_cancelled: ["/exchanges", "/admin/dashboard"],
  exchange_cancelled_after_lock: ["/exchanges", "/admin/dashboard"],
  exchange_event_hidden: ["/exchanges", "/admin/dashboard"],
  exchange_registration_approved: ["/exchanges", "/admin/dashboard"],
  exchange_registration_rejected: ["/exchanges", "/admin/dashboard"],
  exchange_waitlist_promoted: ["/exchanges", "/admin/dashboard"],
  exchange_fee_locked: ["/exchanges", "/admin/dashboard"],
  exchange_fee_changed: ["/exchanges", "/admin/dashboard"],
  exchange_event_cancelled: ["/exchanges", "/admin/dashboard"],
  exchange_reported: ["/", "/admin/exchanges"],
  // Thêm ở G2c Task 4 (thiếu eventCode nên về /exchanges; link đầy đủ ở test riêng).
  exchange_comment_new: ["/exchanges", "/admin/dashboard"],
  exchange_comment_reply: ["/exchanges", "/admin/dashboard"],
  exchange_comment_host_post: ["/exchanges", "/admin/dashboard"],
  exchange_comment_held: ["/exchanges", "/admin/dashboard"],
};

describe("notificationHref", () => {
  it("notificationHref: every existing kind keeps its current member/admin link", () => {
    expect(Object.keys(HREFS).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const kind of NOTIFICATION_KINDS) {
      const [member, admin] = HREFS[kind];
      expect(notificationHref(view(kind), "member"), `${kind} member`).toBe(
        member,
      );
      expect(notificationHref(view(kind), "admin"), `${kind} admin`).toBe(
        admin,
      );
    }
  });
});

describe("notificationHref exchange", () => {
  it("href: exchange kinds link to the event or its manage page", () => {
    const withCode = (kind: NotificationKind) =>
      notificationHref(view(kind, { eventCode: "ab12" }), "member");
    for (const kind of [
      "exchange_registration_received",
      "exchange_registration_cancelled",
      "exchange_cancelled_after_lock",
      "exchange_event_hidden",
    ] as const) {
      expect(withCode(kind), kind).toBe("/exchanges/ab12/manage");
    }
    for (const kind of [
      "exchange_registration_approved",
      "exchange_registration_rejected",
      "exchange_waitlist_promoted",
      "exchange_fee_locked",
      "exchange_fee_changed",
      "exchange_event_cancelled",
    ] as const) {
      expect(withCode(kind), kind).toBe("/exchanges/ab12");
    }
    expect(notificationHref(view("exchange_reported"), "admin")).toBe(
      "/admin/exchanges",
    );
  });
});

describe("notificationHref exchange comments", () => {
  it("href: comment kinds open the right tab anchor", () => {
    const href = (kind: NotificationKind, payload: Record<string, unknown>) =>
      notificationHref(view(kind, { eventCode: "ab12", ...payload }), "member");
    expect(href("exchange_comment_new", { channel: "qa" })).toBe(
      "/exchanges/ab12?channel=qa#comments",
    );
    expect(href("exchange_comment_new", { channel: "group" })).toBe(
      "/exchanges/ab12?channel=group#comments",
    );
    expect(href("exchange_comment_reply", { channel: "group" })).toBe(
      "/exchanges/ab12?channel=group#comments",
    );
    expect(href("exchange_comment_reply", { channel: "qa" })).toBe(
      "/exchanges/ab12?channel=qa#comments",
    );
    expect(href("exchange_comment_held", {})).toBe(
      "/exchanges/ab12?channel=qa#comments",
    );
    expect(href("exchange_comment_host_post", {})).toBe(
      "/exchanges/ab12?channel=group#comments",
    );
    expect(notificationHref(view("exchange_comment_new"), "member")).toBe(
      "/exchanges",
    );
    expect(
      notificationHref(
        view("exchange_reported", { targetType: "comment" }),
        "admin",
      ),
    ).toBe("/admin/exchanges");
  });
});

describe("renderNotification", () => {
  const t = createTranslator({
    locale: "vi",
    messages: vi,
    namespace: "notifications",
  }) as unknown as Translate;
  const NB = " "; // Intl chèn khoảng trắng không ngắt trước "₫"

  const CASES: [NotificationKind, Record<string, unknown>, string, string][] = [
    [
      "session_finalized",
      {
        sessionDate: "2026-11-05",
        startTime: "20:30",
        playAmount: 60000,
        dineAmount: 0,
        guestPlayAmount: 0,
        guestDineAmount: 0,
        guestToFund: 0,
        total: 85000,
        balance: -85000,
      },
      "Đã chốt sổ buổi chơi",
      `Buổi Thứ 5 05/11 lúc 20:30 đã chốt. Bạn phải trả 85.000${NB}₫. Số dư hiện tại: -85.000${NB}₫.`,
    ],
    [
      "payment_confirmed",
      { amount: 120000 },
      "Đã nhận tiền của bạn",
      `Khoản thanh toán 120.000${NB}₫ của bạn đã được ghi nhận. Xem số dư ở mục Quỹ của tôi.`,
    ],
    [
      "fund_refund_recorded",
      { amount: 50000, balance: 1234000 },
      "Đã hoàn tiền quỹ",
      `Bạn vừa được hoàn 50.000${NB}₫ từ quỹ. Số dư hiện tại: 1.234.000${NB}₫.`,
    ],
    [
      "password_changed",
      { byAdmin: true },
      "Mật khẩu đã đổi",
      "Mật khẩu của bạn vừa được đổi. Nếu không phải bạn làm, hãy báo admin ngay.",
    ],
  ];

  it("render: every existing kind renders the same title and body", () => {
    for (const [kind, payload, title, body] of CASES) {
      expect(renderNotification(t, view(kind, payload), "vi"), kind).toEqual({
        title,
        body,
      });
    }
  });
});
