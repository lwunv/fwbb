import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, sessionShuttlecocks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ymdInVNAddDays, dayOfWeekVN } from "@/lib/date-format";
import {
  getDefaultCourt,
  getDefaultBrand,
  getSessionDaysOfWeek,
} from "@/actions/settings";
import { computeDefaultDeadline } from "@/lib/vote-deadline";

export async function GET(request: NextRequest) {
  // Fail-closed nếu CRON_SECRET missing — tránh ai cũng trigger được tạo
  // session tự động. Compare bằng `Bearer ${secret}` exact match.
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

  // Tomorrow ở giờ VN — tránh ranh giới ngày bị lệch khi server chạy UTC.
  const dateStr = ymdInVNAddDays(1);
  const dayOfWeek = dayOfWeekVN(dateStr);

  // Lịch chơi đọc động từ /admin/dashboard setting (default Mon/Wed/Fri).
  const sessionDays = new Set(await getSessionDaysOfWeek());
  if (!sessionDays.has(dayOfWeek)) {
    return NextResponse.json({ message: "Not a session day" });
  }

  // Check if session already exists
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });

  if (existing) {
    return NextResponse.json({ message: "Session already exists" });
  }

  // Pre-fill court + shuttlecock defaults từ /admin/dashboard settings — admin
  // có thể đổi sau. Đồng bộ pattern với auto-create today trong sessions.ts.
  const [defaultCourt, defaultBrand] = await Promise.all([
    getDefaultCourt(),
    getDefaultBrand(),
  ]);

  const [newSession] = await db
    .insert(sessions)
    .values({
      date: dateStr,
      status: "voting",
      courtId: defaultCourt?.id ?? null,
      courtPrice: defaultCourt?.pricePerSession ?? null,
      useMinDeduction: true,
      voteDeadline: computeDefaultDeadline(dateStr, "20:30"),
    })
    .returning();

  if (defaultBrand) {
    await db.insert(sessionShuttlecocks).values({
      sessionId: newSession.id,
      brandId: defaultBrand.id,
      quantityUsed: 1,
      pricePerTube: defaultBrand.pricePerTube,
    });
  }

  return NextResponse.json({ message: `Session created for ${dateStr}` });
}
