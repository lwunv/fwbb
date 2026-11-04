import { isSmtpConfigured } from "@/lib/mailer";
import { getQstashConfig } from "./qstash";

export type NotificationConfigWarning =
  | "appUrlMissing"
  | "qstashMissing"
  | "smtpMissing";

/**
 * Cấu hình còn thiếu khiến một phần thông báo tắt âm thầm, để trang cài đặt
 * cảnh báo admin. Đọc env lúc gọi (không chốt lúc build). Thiếu
 * `NEXT_PUBLIC_APP_URL` thì không hẹn được job QStash, route jobs không kiểm
 * được chữ ký và mọi mail lỗi `app_url_missing`, dù khoá QStash đã đủ.
 */
export function notificationConfigWarnings(): NotificationConfigWarning[] {
  const warnings: NotificationConfigWarning[] = [];
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) warnings.push("appUrlMissing");
  if (getQstashConfig() === null) warnings.push("qstashMissing");
  if (!isSmtpConfigured()) warnings.push("smtpMissing");
  return warnings;
}
