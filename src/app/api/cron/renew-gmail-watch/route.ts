/**
 * Vercel Cron: Renew Gmail Watch
 *
 * Gmail watch expires every 7 days. This cron runs every 6 days to renew.
 * Configured in vercel.json.
 *
 * Schedule: every 6 days (0 0 *\/6 * *)
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
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
