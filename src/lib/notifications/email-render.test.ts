import { describe, it, expect } from "vitest";
import type { NotificationKind } from "./catalog";
import type { NotificationView } from "./render";
import { renderDigestEmail, renderNotificationEmail } from "./email-render";

function view(
  kind: string,
  payload: Record<string, unknown>,
  mandatory: boolean,
  entityId: number | null = 7,
): NotificationView {
  return {
    id: 1,
    kind: kind as NotificationKind,
    entityType: null,
    entityId,
    payload,
    mandatory,
    readAt: null,
    createdAt: "2026-11-04T00:00:00.000Z",
  };
}

const ctx = {
  recipientType: "member" as const,
  recipientId: 42,
  appUrl: "https://fwbb.test/",
  unsubscribeUrl: "https://fwbb.test/unsub?t=abc",
  manageUrl: "https://fwbb.test/me",
  bank: { bankBin: "970454", accountNo: "123456789", accountName: "NGUYEN A" },
};

const finalized = (balance: number) =>
  view(
    "session_finalized",
    { sessionDate: "2026-11-05", startTime: "20:30", total: 85000, balance },
    true,
  );

describe("email-render", () => {
  it("email escapes a venue name containing <script>", () => {
    const out = renderNotificationEmail(
      view(
        "venue_approved",
        { venueName: "<script>alert(1)</script>" },
        false,
        3,
      ),
      ctx,
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("finalized email with negative balance includes a VietQR image for the owed amount", () => {
    const out = renderNotificationEmail(finalized(-85000), ctx);
    expect(out.html).toContain("img.vietqr.io/image/970454-123456789");
    expect(out.html).toContain("amount=85000");
    expect(out.html).toContain("FWBB+NO+42");
    expect(out.text).toContain("FWBB NO 42");
  });

  it("finalized email with non-negative balance has no QR", () => {
    const out = renderNotificationEmail(finalized(15000), ctx);
    expect(out.html).not.toContain("vietqr.io");
  });

  it("debt_reminder carries a QR for the reminded amount", () => {
    const out = renderNotificationEmail(
      view("debt_reminder", { amount: 120000, days: 5 }, true, null),
      ctx,
    );
    expect(out.html).toContain("amount=120000");
  });

  it("optional kinds carry an unsubscribe link; mandatory kinds do not", () => {
    const optional = renderNotificationEmail(
      view(
        "vote_due_soon",
        { sessionDate: "2026-11-05", startTime: "20:30", hoursLeft: 2 },
        false,
      ),
      ctx,
    );
    expect(optional.html).toContain("https://fwbb.test/unsub?t=abc");
    expect(optional.text).toContain("https://fwbb.test/unsub?t=abc");
    const mandatory = renderNotificationEmail(finalized(0), ctx);
    expect(mandatory.html).not.toContain("unsub");
    expect(mandatory.text).not.toContain("unsub");
    const none = renderNotificationEmail(
      view(
        "vote_due_soon",
        { sessionDate: "2026-11-05", startTime: "20:30", hoursLeft: 2 },
        false,
      ),
      { ...ctx, unsubscribeUrl: null },
    );
    expect(none.html).not.toContain("unsub");
  });

  it("every email links to manage notifications and the item, with no dashes", () => {
    const out = renderNotificationEmail(finalized(-1000), ctx);
    expect(out.html).toContain('href="https://fwbb.test/me"');
    expect(out.html).toContain("Quản lý thông báo");
    expect(out.html).toContain("https://fwbb.test/my-fund");
    expect(`${out.subject}${out.text}${out.html}`).not.toMatch(
      /[\u2013\u2014]/,
    );
  });

  it("digest lists every item and escapes", () => {
    const out = renderDigestEmail(
      [
        finalized(0),
        view("venue_approved", { venueName: "<b>x</b>" }, false, 3),
      ],
      ctx,
    );
    expect(out.subject).toContain("2");
    expect(out.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out.text).toContain("Đã chốt sổ buổi chơi");
  });
});

describe("email-render exchange", () => {
  it("email: exchange_fee_locked email has no group fund QR", () => {
    const out = renderNotificationEmail(
      view(
        "exchange_fee_locked",
        {
          eventCode: "ab12",
          eventTitle: "Giao lưu",
          startAt: "2026-11-14T12:00:00.000Z",
          amount: 120000,
          deposit: 0,
          remaining: 120000,
          refundDue: 0,
          aboveEstimate: false,
        },
        true,
        null,
      ),
      ctx,
    );
    expect(out.html).not.toContain("vietqr.io");
    expect(out.text).not.toContain("FWBB NO");
    expect(out.html).toContain("https://fwbb.test/giao-luu/ab12");
    expect(`${out.subject}${out.text}${out.html}`).not.toMatch(
      /[\u2013\u2014]/,
    );
  });
});
