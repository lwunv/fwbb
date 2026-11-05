import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import zh from "@/i18n/messages/zh.json";
import { formatVND } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import type { NotificationKind } from "./catalog";
import {
  notificationHref,
  renderNotification,
  type NotificationView,
  type Translate,
} from "./render";

function translator(locale: "vi" | "en" | "zh"): Translate {
  const t = createTranslator({
    locale,
    messages: { vi, en, zh }[locale],
    namespace: "notifications",
  });
  return (key, values) =>
    (t as unknown as (k: string, v?: unknown) => string)(key, values);
}

function view(
  kind: string,
  payload: Record<string, unknown> = {},
  entityId: number | null = 7,
): NotificationView {
  return {
    id: 1,
    kind: kind as NotificationKind,
    entityType: null,
    entityId,
    payload,
    mandatory: false,
    readAt: null,
    createdAt: "2026-11-04T00:00:00.000Z",
  };
}

describe("render", () => {
  it("session_finalized shows own total as VND", () => {
    const { body } = renderNotification(
      translator("vi"),
      view("session_finalized", {
        sessionDate: "2026-11-05",
        startTime: "20:30",
        total: 85000,
        balance: -85000,
      }),
      "vi",
    );
    expect(body).toContain(formatVND(85000));
  });

  it("unknown kind falls back without throwing", () => {
    const out = renderNotification(
      translator("vi"),
      view("from_the_future"),
      "vi",
    );
    expect(out.title).toBeTruthy();
    expect(out.body).toBeTruthy();
  });

  it("en locale formats the session date in English", () => {
    const payload = { sessionDate: "2026-11-05", startTime: "20:30" };
    const { body } = renderNotification(
      translator("en"),
      view("session_opened", payload),
      "en",
    );
    expect(body).toContain(formatSessionDate("2026-11-05", "weekday", "en"));
    expect(body).toContain("Thu");
  });

  it("every kind renders in vi, en and zh without leftover placeholders", () => {
    const payload = {
      sessionDate: "2026-11-05",
      startTime: "20:30",
      hoursLeft: 2,
      fields: ["time", "court"],
      when: "3h",
      courtName: "San A",
      total: 1000,
      oldTotal: 500,
      balance: 2000,
      amount: 3000,
      purpose: "fund",
      reason: "",
      days: 7,
      provider: "Google",
      venueName: "San B",
      rank: 1,
      headcount: 15,
      maxPlayers: 16,
      courtLockAt: "2026-11-04T13:30:00.000Z",
      memberName: "An",
      names: ["An", "Binh"],
      proposerName: "Chi",
      brandName: "Yonex",
      stockQua: 5,
      month: "2026-10",
      errorCount: 2,
      debtorCount: 1,
      upcomingCount: 2,
      pendingCount: 3,
    };
    const kinds = Object.keys(vi.notifications.kinds).filter(
      (k) => k !== "unknown",
    );
    for (const locale of ["vi", "en", "zh"] as const) {
      for (const kind of kinds) {
        const out = renderNotification(
          translator(locale),
          view(kind, payload),
          locale,
        );
        expect(out.title + out.body, `${locale}.${kind}`).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("vote_due_soon", () => {
  it("renders any number of hours, with English singular for 1", () => {
    const at = (hoursLeft: number, locale: "vi" | "en" | "zh") =>
      renderNotification(
        translator(locale),
        view("vote_due_soon", {
          sessionDate: "2026-11-05",
          startTime: "20:30",
          hoursLeft,
        }),
        locale,
      ).body;
    expect(at(10, "vi")).toContain("Còn 10 giờ");
    expect(at(1, "en")).toContain("closes in 1 hour.");
    expect(at(10, "en")).toContain("closes in 10 hours.");
    expect(at(10, "zh")).toContain("10");
  });
});

describe("weekly_summary", () => {
  const base = { debtorCount: 22, upcomingCount: 2, pendingCount: 1 };
  const debtors = [
    { name: "An", amount: 150_000 },
    { name: "Bình", amount: 90_000 },
  ];

  it("lists long-term debtors with amounts and says how many more are not listed", () => {
    for (const locale of ["vi", "en", "zh"] as const) {
      const { body } = renderNotification(
        translator(locale),
        view("weekly_summary", { ...base, debtors }),
        locale,
      );
      expect(body, locale).toContain(`An (${formatVND(150_000)})`);
      expect(body, locale).toContain(`Bình (${formatVND(90_000)})`);
      expect(body, locale).toContain("20");
      expect(body, locale).not.toMatch(/[{}]|object Object/);
    }
    const vi20 = renderNotification(
      translator("vi"),
      view("weekly_summary", { ...base, debtors }),
      "vi",
    ).body;
    expect(vi20).toContain("và 20 người khác");
  });

  it("all debtors listed: no 'more' clause; old payloads without names still render", () => {
    const full = renderNotification(
      translator("en"),
      view("weekly_summary", { ...base, debtorCount: 2, debtors }),
      "en",
    ).body;
    expect(full).toContain("An (");
    expect(full).not.toContain("more");
    const old = renderNotification(
      translator("vi"),
      view("weekly_summary", base),
      "vi",
    ).body;
    expect(old).toContain("22 người đang nợ quá 30 ngày");
    expect(old).not.toMatch(/[{}]|object Object/);
  });
});

describe("money kinds", () => {
  it("session_deleted_refund with a negative amount says the pass money was taken back, without a minus sign", () => {
    const out = renderNotification(
      translator("vi"),
      view("session_deleted_refund", {
        sessionDate: "2026-11-05",
        startTime: "20:30",
        amount: -150000,
        balance: 0,
      }),
      "vi",
    );
    expect(out.title).toContain("rút lại");
    expect(out.body).toContain(formatVND(150000));
    expect(out.body).not.toContain("-");
  });

  it("member_reported_transfer for a debt names the session date", () => {
    const { body } = renderNotification(
      translator("en"),
      view("member_reported_transfer", {
        memberName: "An",
        amount: 85000,
        purpose: "debt",
        sessionDate: "2026-11-05",
      }),
      "en",
    );
    expect(body).toContain(formatSessionDate("2026-11-05", "weekday", "en"));
    expect(body).toContain(formatVND(85000));
  });

  it("session_amount_changed shows the old and the new total", () => {
    const { body } = renderNotification(
      translator("vi"),
      view("session_amount_changed", {
        sessionDate: "2026-11-05",
        startTime: "20:30",
        oldTotal: 100000,
        total: 130000,
        balance: -130000,
      }),
      "vi",
    );
    expect(body).toContain(formatVND(100000));
    expect(body).toContain(formatVND(130000));
  });
});

describe("capacity_alert", () => {
  const base = {
    sessionDate: "2026-11-05",
    startTime: "20:30",
    headcount: 14,
    maxPlayers: 16,
    courtLockAt: "2026-11-04T13:30:00.000Z",
  };

  it("has its own text per rank, with counts and the court deadline", () => {
    const out = [1, 2, 3, 4].map((rank) =>
      renderNotification(
        translator("vi"),
        view("capacity_alert", { ...base, rank }),
        "vi",
      ),
    );
    const titles = out.map((o) => o.title);
    expect(titles[0]).toContain("sắp đầy");
    expect(titles[1]).toContain("đầy chỗ");
    expect(titles[2]).toContain("vượt");
    expect(titles[3]).toBe(titles[2]);
    expect(new Set(out.map((o) => o.body)).size).toBe(3);
    for (const o of out) {
      expect(o.body).toContain("14/16");
      expect(o.body).toContain("04/11 20:30");
    }
    expect(out[1].body).toContain("đặt thêm sân hoặc khoá vote");
    expect(out[2].body).toContain("đặt thêm sân hoặc khoá vote");
  });

  it("renders ISO instants in Vietnam time whatever the server TZ", () => {
    const prev = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const { body } = renderNotification(
        translator("en"),
        view("capacity_alert", { ...base, rank: 2 }),
        "en",
      );
      expect(body).toContain("04/11 20:30");
      expect(body).not.toContain("13:30");
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });
});

describe("href", () => {
  it("member session kinds link to /vote/{id}; admin capacity_alert links to /admin/sessions/{id}; deleted refund links to /my-fund", () => {
    expect(notificationHref(view("session_opened"), "member")).toBe("/vote/7");
    expect(notificationHref(view("session_cancelled"), "member")).toBe(
      "/vote/7",
    );
    expect(notificationHref(view("capacity_alert"), "admin")).toBe(
      "/admin/sessions/7",
    );
    expect(notificationHref(view("session_deleted_refund"), "member")).toBe(
      "/my-fund",
    );
  });

  it("routes the other groups", () => {
    expect(notificationHref(view("payment_confirmed"), "member")).toBe(
      "/my-fund",
    );
    expect(notificationHref(view("password_changed"), "member")).toBe("/me");
    expect(notificationHref(view("venue_approved"), "member")).toBe("/san");
    expect(notificationHref(view("signup_pending"), "admin")).toBe(
      "/admin/members",
    );
    expect(notificationHref(view("venue_pending"), "admin")).toBe(
      "/admin/venues",
    );
    expect(notificationHref(view("low_stock"), "admin")).toBe(
      "/admin/inventory",
    );
    expect(notificationHref(view("reconcile_failed"), "admin")).toBe(
      "/admin/finance",
    );
    expect(notificationHref(view("court_rent_unpaid"), "admin")).toBe(
      "/admin/court-rent",
    );
  });
});

describe("render exchange kinds", () => {
  const NB = " ";
  const base = {
    eventCode: "ab12",
    eventTitle: "Giao lưu Thứ 7",
    startAt: "2026-11-14T12:00:00.000Z",
  };

  it("render: fee_locked formats amount, deposit, remaining and refundDue as VND", () => {
    const pay = renderNotification(
      translator("vi"),
      view("exchange_fee_locked", {
        ...base,
        amount: 120000,
        deposit: 50000,
        remaining: 70000,
        refundDue: 0,
        aboveEstimate: false,
      }),
      "vi",
    ).body;
    expect(pay).toContain(`120.000${NB}₫`);
    expect(pay).toContain(`50.000${NB}₫`);
    expect(pay).toContain(`70.000${NB}₫`);
    const refund = renderNotification(
      translator("vi"),
      view("exchange_fee_locked", {
        ...base,
        amount: 30000,
        deposit: 50000,
        remaining: 0,
        refundDue: 20000,
        aboveEstimate: false,
      }),
      "vi",
    ).body;
    expect(refund).toContain(`20.000${NB}₫`);
    expect(refund).not.toContain("NaN");
  });

  it("render: booleans pick the right sentence, never true/false", () => {
    for (const locale of ["vi", "en", "zh"] as const) {
      const t = translator(locale);
      const run = (kind: string, payload: Record<string, unknown>) => {
        const { title, body } = renderNotification(
          t,
          view(kind, { ...base, heads: 2, ...payload }),
          locale,
        );
        return `${title} ${body}`;
      };
      const a = run("exchange_registration_cancelled", { late: true });
      const b = run("exchange_registration_cancelled", { late: false });
      expect(a).not.toBe(b);
      const c = run("exchange_registration_received", { needsApproval: true });
      const d = run("exchange_registration_received", { needsApproval: false });
      expect(c).not.toBe(d);
      const e = run("exchange_cancelled_after_lock", { late: true });
      const f = run("exchange_cancelled_after_lock", { late: false });
      expect(e).not.toBe(f);
      const fee = (aboveEstimate: boolean) =>
        run("exchange_fee_locked", {
          amount: 1000,
          deposit: 0,
          remaining: 1000,
          refundDue: 0,
          aboveEstimate,
        });
      expect(fee(true)).not.toBe(fee(false));
      const p1 = run("exchange_waitlist_promoted", { status: "pending" });
      const p2 = run("exchange_waitlist_promoted", { status: "approved" });
      expect(p1).not.toBe(p2);
      for (const text of [a, b, c, d, e, f, fee(true), fee(false), p1, p2]) {
        expect(text).not.toMatch(/\btrue\b|\bfalse\b/);
      }
    }
  });

  it("render: fee_changed says so when the person is no longer charged", () => {
    const t = translator("vi");
    const out = renderNotification(
      t,
      view("exchange_fee_changed", {
        ...base,
        amount: 0,
        previousAmount: 90000,
        deposit: 0,
        remaining: 0,
        refundDue: 0,
        aboveEstimate: false,
      }),
      "vi",
    );
    expect(out.body).toContain(`90.000${NB}₫`);
    expect(out.body).toMatch(/không còn/i);
  });

  it("render: report reason is translated, not a raw code", () => {
    for (const locale of ["vi", "en", "zh"] as const) {
      const out = renderNotification(
        translator(locale),
        view("exchange_reported", {
          targetType: "event",
          reason: "fake_account",
        }),
        locale,
      );
      expect(out.body).not.toContain("fake_account");
    }
    const viOut = renderNotification(
      translator("vi"),
      view("exchange_reported", {
        targetType: "event",
        reason: "fake_account",
      }),
      "vi",
    );
    expect(viOut.body).not.toContain("event");
  });
});
