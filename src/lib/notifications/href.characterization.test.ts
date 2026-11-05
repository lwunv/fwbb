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
  venue_approved: ["/san", "/admin/dashboard"],
  venue_hidden: ["/san", "/admin/dashboard"],
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
