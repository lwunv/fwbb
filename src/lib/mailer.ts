import nodemailer from "nodemailer";

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
