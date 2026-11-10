import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { runDailyNotifications } from "@/lib/notifications/daily";
import { isNotificationsEnabled } from "@/lib/notifications/gate";
import { pruneIpSignalsDaily } from "@/lib/reputation/ip-signals";

export const maxDuration = 60;

/**
 * Cron 06:00 VN (`0 23 * * *` UTC): lưới an toàn của thông báo (báo mở vote,
 * chạy job lỡ, hẹn lại nhắc giờ), nhắc nợ, tóm tắt tuần, tiền sân, kiểm sổ
 * quỹ, dọn dữ liệu cũ. Kiểm `CRON_SECRET` y như cron tạo buổi.
 */
export async function GET(request: NextRequest) {
  // Fail-closed khi thiếu CRON_SECRET: không để ai cũng gọi được.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET missing" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isNotificationsEnabled(db))) {
    // Tín hiệu mạng vẫn phải hết hạn sau 30 ngày khi tắt thông báo (G2d,
    // quyết định 55). Khi bật, runDailyNotifications tự dọn ở bước đầu. Lỗi
    // dọn không đổi phản hồi `skipped`; lần chạy sau dọn tiếp.
    try {
      await pruneIpSignalsDaily(db, new Date());
    } catch {
      console.error("[DupSignal] prune_failed");
    }
    return NextResponse.json({ skipped: "disabled" });
  }
  return NextResponse.json(await runDailyNotifications(db, new Date()));
}
