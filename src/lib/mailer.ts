import nodemailer from "nodemailer";
import { formatVND } from "@/lib/utils";

const HOST = process.env.SMTP_HOST;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const PORT = Number(process.env.SMTP_PORT ?? 465);
const SECURE = (process.env.SMTP_SECURE ?? "true") === "true";
const FROM = process.env.MAIL_FROM ?? "FWBB <no-reply@fwbb>";

interface MailResult {
  success: boolean;
  error?: string;
}

function buildResetEmail(resetUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "FWBB — Đặt lại mật khẩu / Reset your password";
  const text = [
    "Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu FWBB.",
    "Mở liên kết sau để đặt mật khẩu mới (hết hạn sau 60 phút):",
    resetUrl,
    "",
    "Nếu không phải bạn yêu cầu, hãy bỏ qua email này.",
    "",
    "— You (or someone) requested an FWBB password reset.",
    `Open this link to set a new password (expires in 60 minutes): ${resetUrl}`,
    "If you didn't request this, ignore this email.",
  ].join("\n");
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px">Đặt lại mật khẩu FWBB</h2>
    <p style="font-size:15px;line-height:1.5">Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu. Nhấn nút dưới đây để đặt mật khẩu mới — liên kết hết hạn sau <b>60 phút</b>.</p>
    <p style="margin:20px 0"><a href="${resetUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:15px">Đặt lại mật khẩu</a></p>
    <p style="font-size:13px;color:#666;word-break:break-all">Hoặc mở liên kết: ${resetUrl}</p>
    <p style="font-size:13px;color:#666">Nếu không phải bạn yêu cầu, hãy bỏ qua email này. / If you didn't request this, ignore this email.</p>
  </div>`;
  return { subject, text, html };
}

function buildInviteEmail(
  setupUrl: string,
  appName: string,
): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Mời tham gia FWBB / You're invited to FWBB";
  const text = [
    `Bạn đã được thêm vào nhóm ${appName}.`,
    "Mở liên kết sau để đặt mật khẩu và bắt đầu (hết hạn sau 7 ngày):",
    setupUrl,
    "",
    `— You've been added to the ${appName} group.`,
    `Open this link to set your password and get started (expires in 7 days): ${setupUrl}`,
  ].join("\n");
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px">Mời tham gia ${appName}</h2>
    <p style="font-size:15px;line-height:1.5">Bạn đã được thêm vào nhóm ${appName}. Nhấn nút dưới đây để đặt mật khẩu và bắt đầu sử dụng — liên kết hết hạn sau <b>7 ngày</b>.</p>
    <p style="margin:20px 0"><a href="${setupUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:15px">Đặt mật khẩu</a></p>
    <p style="font-size:13px;color:#666;word-break:break-all">Hoặc mở liên kết: ${setupUrl}</p>
  </div>`;
  return { subject, text, html };
}

/**
 * Send a password-reset email. Non-blocking pattern (mirrors messenger.ts):
 * logs and returns {success:false} on any failure, never throws.
 * Requires the Node.js runtime (nodemailer uses net/tls) — never import on Edge.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<MailResult> {
  if (!HOST || !USER || !PASS) {
    console.warn(
      "[Mailer] SMTP not configured (SMTP_HOST/USER/PASS) — skipping send.",
    );
    // Dev affordance: surface the link so QA can complete the flow locally.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Mailer][dev] password reset URL: ${resetUrl}`);
    }
    return { success: false, error: "SMTP not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: { user: USER, pass: PASS },
    });
    const { subject, text, html } = buildResetEmail(resetUrl);
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    return { success: true };
  } catch (err) {
    console.error(
      "[Mailer] send failed:",
      err instanceof Error ? err.message : err,
    );
    return { success: false, error: "send failed" };
  }
}

/**
 * Send an invite email to a newly-added member, prompting them to set up
 * their password. Same non-throwing pattern as sendPasswordResetEmail.
 * Requires the Node.js runtime (nodemailer uses net/tls) — never import on Edge.
 */
export async function sendInviteEmail(
  to: string,
  setupUrl: string,
  opts?: { appName?: string },
): Promise<MailResult> {
  const appName = opts?.appName ?? "FWBB";
  if (!HOST || !USER || !PASS) {
    console.warn(
      "[Mailer] SMTP not configured (SMTP_HOST/USER/PASS) — skipping send.",
    );
    // Dev affordance: surface the link so QA can complete the flow locally.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Mailer][dev] invite setup URL: ${setupUrl}`);
    }
    return { success: false, error: "SMTP not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: { user: USER, pass: PASS },
    });
    const { subject, text, html } = buildInviteEmail(setupUrl, appName);
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    return { success: true };
  } catch (err) {
    console.error(
      "[Mailer] send failed:",
      err instanceof Error ? err.message : err,
    );
    return { success: false, error: "send failed" };
  }
}

export type MailOutcome =
  | { ok: true }
  | { ok: false; code: "not_configured" | "transient" | "permanent" };

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

/** SMTP đủ cấu hình để gửi (đọc env lúc gọi). Trang cài đặt dùng để cảnh báo. */
export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

/**
 * 5xx từ máy chủ mail hoặc EENVELOPE (địa chỉ không hợp lệ) thì thử lại vô ích.
 * Mạng, timeout, 4xx (greylist, quá tải) thì hàng đợi nên thử lại sau.
 */
function classifySendError(err: unknown): "transient" | "permanent" {
  const e = err as { code?: unknown; responseCode?: unknown } | null;
  if (e?.code === "EENVELOPE") return "permanent";
  const rc = Number(e?.responseCode);
  return rc >= 500 && rc < 600 ? "permanent" : "transient";
}

/**
 * Gửi một email thông báo. Không bao giờ throw và không log địa chỉ hay nội dung
 * thư; người gọi (outbox) dựa vào `code` để quyết định thử lại hay bỏ.
 * Đọc env lúc gọi (không chốt lúc import) để thiếu cấu hình hiện ra đúng chỗ.
 * Cần runtime Node.js (nodemailer dùng net/tls), không import ở Edge.
 */
export async function sendMail(msg: MailMessage): Promise<MailOutcome> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[Mailer] SMTP not configured (SMTP_HOST/USER/PASS)");
    return { ok: false, code: "not_configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") === "true",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? "FWBB <no-reply@fwbb>",
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
    });
    return { ok: true };
  } catch (err) {
    const code = classifySendError(err);
    console.error("[Mailer] send failed", { code });
    return { ok: false, code };
  }
}

/** Escape dữ liệu người dùng nhập (tên, mô tả) trước khi nhét vào HTML mail. */
function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type AdminDebtAlertInput = {
  memberName: string;
  balanceBefore: number;
  balanceAfter: number;
  description: string | null;
  link: string;
};

/**
 * Mail báo admin khi một member vừa âm quỹ (quyết định user 9/11/2026, song
 * song với chuông thông báo). Tên và mô tả là dữ liệu người dùng nhập nên
 * PHẢI escape trong HTML.
 */
export function buildAdminDebtAlertEmail(input: AdminDebtAlertInput): {
  subject: string;
  text: string;
  html: string;
} {
  const before = formatVND(input.balanceBefore);
  const after = formatVND(input.balanceAfter);
  const subject = `FWBB: ${input.memberName} vừa âm quỹ (${after})`;
  const text = [
    `${input.memberName} vừa âm quỹ.`,
    `Số dư: ${before} → ${after}`,
    ...(input.description ? [`Khoản gây ra: ${input.description}`] : []),
    "",
    `Xem sổ quỹ: ${input.link}`,
  ].join("\n");
  const name = escapeHtml(input.memberName);
  const desc = input.description ? escapeHtml(input.description) : "";
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:16px;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px">${name} vừa âm quỹ</h2>
    <p style="font-size:15px;line-height:1.5">Số dư: <b>${escapeHtml(before)}</b> → <b style="color:#dc2626">${escapeHtml(after)}</b></p>
    ${desc ? `<p style="font-size:14px;color:#444">Khoản gây ra: ${desc}</p>` : ""}
    <p style="margin:20px 0"><a href="${escapeHtml(input.link)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:15px">Xem sổ quỹ</a></p>
  </div>`;
  return { subject, text, html };
}

/**
 * Gửi mail báo âm quỹ cho các admin. Cùng kiểu không-ném-lỗi như các hàm trên.
 * KHÔNG log tên hay email (dữ liệu cá nhân), chỉ log lý do lỗi.
 */
export async function sendAdminDebtAlertEmail(
  to: string[],
  input: AdminDebtAlertInput,
): Promise<MailResult> {
  if (to.length === 0) return { success: false, error: "no recipients" };
  if (!HOST || !USER || !PASS) {
    console.warn(
      "[Mailer] SMTP not configured (SMTP_HOST/USER/PASS) — skipping debt alert.",
    );
    return { success: false, error: "SMTP not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      auth: { user: USER, pass: PASS },
    });
    const { subject, text, html } = buildAdminDebtAlertEmail(input);
    await transporter.sendMail({ from: FROM, to, subject, text, html });
    return { success: true };
  } catch (err) {
    // Chỉ log mã lỗi: message của nodemailer (vd SMTP từ chối người nhận) có
    // thể chứa địa chỉ email admin (dữ liệu cá nhân).
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "unknown";
    console.error("[Mailer] debt alert send failed", { code });
    return { success: false, error: "send failed" };
  }
}
