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
      balance: 2000,
      amount: 3000,
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
