import { after } from "next/server";

/**
 * Hẹn việc chạy sau khi phản hồi đã gửi (kho, email, QStash). Ngoài request
 * scope (test, script) `after()` ném lỗi: bỏ qua có chủ đích, cron hằng ngày
 * bù. Callback phải trả promise để `waitUntil` chờ được. Không bao giờ ném.
 */
export function runAfterResponse(fn: () => Promise<unknown>): void {
  try {
    after(() =>
      fn().catch(() => {
        console.error("[Notify] after_failed");
      }),
    );
  } catch {
    // Ngoài request scope: bỏ qua, cron bù.
  }
}
