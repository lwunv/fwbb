import { Client, Receiver } from "@upstash/qstash";

/** Gói free của QStash chỉ hẹn tối đa 7 ngày; xa hơn thì cron hằng ngày đăng sau. */
export const QSTASH_MAX_DELAY_MS = 7 * 24 * 3_600_000;

export type QstashConfig = {
  token: string;
  currentSigningKey: string;
  nextSigningKey: string;
  baseUrl?: string;
};

/**
 * Đọc env lúc dùng. Thiếu khoá nào thì `null`: không đăng job, nhắc giờ chạy
 * theo cron hằng ngày và trang cài đặt hiện cảnh báo. `QSTASH_URL` tuỳ vùng,
 * không có thì để SDK dùng mặc định.
 */
export function getQstashConfig(): QstashConfig | null {
  const token = process.env.QSTASH_TOKEN;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!token || !currentSigningKey || !nextSigningKey) return null;
  const baseUrl = process.env.QSTASH_URL || undefined;
  return { token, currentSigningKey, nextSigningKey, baseUrl };
}

/** URL QStash gọi lại; cũng là `sub` trong chữ ký. Thiếu app URL thì `null`. */
function jobsEndpoint(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/api/notifications/jobs`;
}

function client(cfg: QstashConfig): Client {
  return new Client({ token: cfg.token, baseUrl: cfg.baseUrl });
}

/**
 * Hẹn QStash gọi route jobs đúng `runAt`. Mã chống lặp gồm cả `runAt` nên đổi
 * giờ cùng key vẫn đăng được message mới. `revision` (số lần job bị huỷ rồi
 * hồi sinh) tách mã của lần đăng lại khỏi message đã huỷ cùng key và giờ:
 * QStash giữ mã chống lặp 90 ngày và lặng lẽ bỏ message trùng mã.
 * Thiếu cấu hình, quá 7 ngày, hoặc QStash lỗi → `null` (cron hằng ngày bù).
 */
export async function publishJob(job: {
  jobKey: string;
  runAt: Date;
  revision?: number;
}): Promise<{ messageId: string } | null> {
  const cfg = getQstashConfig();
  const url = jobsEndpoint();
  if (!cfg || !url) return null;
  if (job.runAt.getTime() > Date.now() + QSTASH_MAX_DELAY_MS) return null;
  const runAt = job.runAt.toISOString();
  const dedup = `${job.jobKey}:${runAt}`;
  try {
    const res = await client(cfg).publishJSON({
      url,
      body: { jobKey: job.jobKey, runAt },
      notBefore: Math.floor(job.runAt.getTime() / 1000),
      deduplicationId: job.revision ? `${dedup}:r${job.revision}` : dedup,
    });
    return { messageId: res.messageId };
  } catch {
    console.error("[Notify] qstash_publish_failed");
    return null;
  }
}

/**
 * Huỷ message đã hẹn. Best-effort: lỗi chỉ log mã, vì message cũ có tới thì
 * route cũng bỏ qua (job không còn `scheduled` hoặc lệch `runAt`).
 */
export async function cancelJobMessage(messageId: string): Promise<void> {
  const cfg = getQstashConfig();
  if (!cfg) return;
  try {
    await client(cfg).messages.cancel(messageId);
  } catch {
    console.error("[Notify] qstash_cancel_failed");
  }
}

/**
 * Kiểm chữ ký `upstash-signature` trên body thô, với cả khoá hiện tại và khoá
 * kế tiếp (xoay khoá), và URL đích. Mọi lỗi, kể cả thiếu cấu hình → `false`.
 */
export async function verifyQstashRequest(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const cfg = getQstashConfig();
  const url = jobsEndpoint();
  if (!cfg || !url) return false;
  try {
    const receiver = new Receiver({
      currentSigningKey: cfg.currentSigningKey,
      nextSigningKey: cfg.nextSigningKey,
      // Không bao giờ dùng khoá của dev server QStash, dù có biến QSTASH_DEV.
      devMode: false,
    });
    return await receiver.verify({ signature, body: rawBody, url });
  } catch {
    return false;
  }
}
