import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { runMorningMail } from "@/lib/notifications/daily";
import { isNotificationsEnabled } from "@/lib/notifications/gate";

export const maxDuration = 60;

/**
 * Cron 07:00 VN (`0 0 * * *` UTC), ngay khi hết giờ yên lặng: gửi mail đã dồn
 * qua đêm và tóm tắt ngày. Kiểm `CRON_SECRET` y như cron tạo buổi.
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
    return NextResponse.json({ skipped: "disabled" });
  }
  return NextResponse.json(await runMorningMail(db, new Date()));
}
