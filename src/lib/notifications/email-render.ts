import { createTranslator } from "next-intl";
import vi from "@/i18n/messages/vi.json";
import type { ResolvedBankAccount } from "@/lib/bank-account";
import { getVietQRUrl } from "@/lib/vietqr";
import { formatVND } from "@/lib/utils";
import {
  notificationHref,
  renderNotification,
  type NotificationView,
  type Translate,
} from "./render";

export interface EmailContext {
  recipientType: "member" | "admin";
  /** Id người nhận, dùng cho nội dung chuyển khoản `FWBB NO {id}`. */
  recipientId: number;
  appUrl: string;
  /** Null thì bỏ link huỷ nhận (chưa có token hoặc không áp dụng). */
  unsubscribeUrl: string | null;
  manageUrl: string;
  bank?: ResolvedBankAccount;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const DEBT_KINDS = new Set([
  "session_finalized",
  "session_amount_changed",
  "debt_reminder",
]);

function translator(): Translate {
  const t = createTranslator({
    locale: "vi",
    messages: vi,
    namespace: "notifications",
  });
  return (key, values) =>
    (t as unknown as (k: string, v?: unknown) => string)(key, values);
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Số tiền member đang nợ theo tin này (VND nguyên), 0 nếu không nợ. Tin chốt sổ
 * và đổi số tiền mang `balance` (âm = nợ); nhắc nợ chỉ mang `amount`.
 */
function owedAmount(item: NotificationView): number {
  if (!DEBT_KINDS.has(item.kind)) return 0;
  const { balance, amount } = item.payload as {
    balance?: unknown;
    amount?: unknown;
  };
  if (typeof balance === "number") return balance < 0 ? -balance : 0;
  if (item.kind === "debt_reminder" && typeof amount === "number") {
    return amount > 0 ? amount : 0;
  }
  return 0;
}

function qrBlock(
  item: NotificationView,
  ctx: EmailContext,
): { html: string; text: string } | null {
  if (ctx.recipientType !== "member" || !ctx.bank) return null;
  const owed = owedAmount(item);
  if (owed <= 0) return null;
  const memo = `FWBB NO ${ctx.recipientId}`;
  const url = getVietQRUrl({
    bankBin: ctx.bank.bankBin,
    accountNo: ctx.bank.accountNo,
    accountName: ctx.bank.accountName,
    amount: owed,
    memo,
  });
  const money = formatVND(owed);
  return {
    html: `<p style="margin:16px 0 4px;font-size:16px">Quét mã để chuyển ${esc(money)}:</p>
<p style="margin:0"><img src="${esc(url)}" alt="Mã QR chuyển khoản ${esc(money)}" width="280" style="max-width:100%;height:auto;border-radius:8px"></p>
<p style="margin:8px 0 0;font-size:14px;color:#555">Nội dung chuyển khoản: <b>${esc(memo)}</b></p>`,
    text: [
      `Chuyển khoản ${money} tới ${ctx.bank.accountName}, số tài khoản ${ctx.bank.accountNo}.`,
      `Nội dung chuyển khoản: ${memo}`,
    ].join("\n"),
  };
}

function footer(
  items: NotificationView[],
  ctx: EmailContext,
): { html: string; text: string } {
  const hasOptional = items.some((i) => !i.mandatory);
  const unsub = hasOptional ? ctx.unsubscribeUrl : null;
  const htmlLinks = [
    `<a href="${esc(ctx.manageUrl)}" style="color:#2563eb">Quản lý thông báo</a>`,
    ...(unsub
      ? [`<a href="${esc(unsub)}" style="color:#2563eb">Huỷ nhận email này</a>`]
      : []),
  ];
  const textLines = [
    `Quản lý thông báo: ${ctx.manageUrl}`,
    ...(unsub ? [`Huỷ nhận email này: ${unsub}`] : []),
  ];
  return {
    html: `<p style="margin:24px 0 0;font-size:14px;color:#666">${htmlLinks.join(" | ")}</p>`,
    text: textLines.join("\n"),
  };
}

function wrap(inner: string): string {
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;color:#111">${inner}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:16px 0"><a href="${esc(href)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:16px">${esc(label)}</a></p>`;
}

export function renderNotificationEmail(
  item: NotificationView,
  ctx: EmailContext,
): RenderedEmail {
  const { title, body } = renderNotification(translator(), item, "vi");
  const href = absoluteUrl(
    ctx.appUrl,
    notificationHref(item, ctx.recipientType),
  );
  const qr = qrBlock(item, ctx);
  const foot = footer([item], ctx);

  const html = wrap(
    `<h2 style="font-size:18px;margin:0 0 12px">${esc(title)}</h2>
<p style="font-size:16px;line-height:1.5;margin:0">${esc(body)}</p>
${qr ? qr.html : ""}
${button(href, "Xem chi tiết")}
${foot.html}`,
  );
  const text = [
    title,
    "",
    body,
    ...(qr ? ["", qr.text] : []),
    "",
    `Xem chi tiết: ${href}`,
    "",
    foot.text,
  ].join("\n");
  return { subject: `FWBB: ${title}`, text, html };
}

export function renderDigestEmail(
  items: NotificationView[],
  ctx: EmailContext,
): RenderedEmail {
  const t = translator();
  const rendered = items.map((item) => ({
    ...renderNotification(t, item, "vi"),
    href: absoluteUrl(ctx.appUrl, notificationHref(item, ctx.recipientType)),
    qr: qrBlock(item, ctx),
  }));
  const foot = footer(items, ctx);
  const subject = `FWBB: bạn có ${items.length} thông báo mới`;

  const htmlItems = rendered
    .map(
      (r) => `<div style="padding:12px 0;border-top:1px solid #e5e7eb">
<p style="font-size:16px;font-weight:600;margin:0 0 4px">${esc(r.title)}</p>
<p style="font-size:16px;line-height:1.5;margin:0">${esc(r.body)}</p>
${r.qr ? r.qr.html : ""}
<p style="margin:8px 0 0;font-size:14px"><a href="${esc(r.href)}" style="color:#2563eb">Xem chi tiết</a></p>
</div>`,
    )
    .join("\n");
  const html = wrap(
    `<h2 style="font-size:18px;margin:0 0 12px">Bạn có ${items.length} thông báo mới</h2>
${htmlItems}
${foot.html}`,
  );
  const text = [
    `Bạn có ${items.length} thông báo mới`,
    "",
    ...rendered.flatMap((r) => [
      r.title,
      r.body,
      ...(r.qr ? [r.qr.text] : []),
      `Xem chi tiết: ${r.href}`,
      "",
    ]),
    foot.text,
  ].join("\n");
  return { subject, text, html };
}
