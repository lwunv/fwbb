/**
 * Vercel Cron: Renew Gmail Watch
 *
 * Gmail watch expires every 7 days. This cron runs DAILY to renew, leaving a
 * 6-day safety margin so a single failed/delayed run never lets the watch
 * lapse. A lapsed watch = Pub/Sub stops pushing = real bank transfers silently
 * stop being recorded. Configured in vercel.json.
 *
 * Schedule: daily (0 0 * * *)
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Fail-closed: nếu CRON_SECRET không set → endpoint công khai, ai cũng có
  // thể trigger renew Gmail watch (DoS quota + DB writes). Refuse-to-start
  // pattern: nếu env thiếu, return 500 thay vì allow-all.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Server misconfigured: CRON_SECRET missing" },
      { status: 500 },
    );
  }
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/webhooks/gmail`;
  const pushSecret = process.env.GMAIL_PUSH_WEBHOOK_SECRET;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(pushSecret ? { "x-gmail-push-secret": pushSecret } : {}),
      },
      body: JSON.stringify({ action: "renew-watch" }),
    });

    const data = await res.json();

    // fetch() KHÔNG reject trên HTTP 4xx/5xx. Nếu inner webhook trả non-2xx
    // (thiếu env, token refresh fail, secret mismatch...) mà ta vẫn báo
    // status:"ok" 200 thì Vercel Cron coi như thành công → renew fail âm thầm,
    // sau 7 ngày watch hết hạn, Pub/Sub ngừng đẩy, chuyển khoản không được ghi.
    // Phải phản ánh thất bại ra HTTP status để cron báo đỏ.
    if (!res.ok) {
      return NextResponse.json(
        { status: "error", statusCode: res.status, watchResult: data },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: "ok",
      watchResult: data,
      renewedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Renew failed" },
      { status: 500 },
    );
  }
}
