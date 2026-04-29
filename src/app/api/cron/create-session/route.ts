import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ymdInVNAddDays, dayOfWeekVN } from "@/lib/date-format";

// Lịch cố định: Mon=1, Wed=3, Fri=5 (theo giờ VN).
const SESSION_DAYS = new Set([1, 3, 5]);

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Tomorrow ở giờ VN — tránh ranh giới ngày bị lệch khi server chạy UTC.
  const dateStr = ymdInVNAddDays(1);
  const dayOfWeek = dayOfWeekVN(dateStr);

  if (!SESSION_DAYS.has(dayOfWeek)) {
    return NextResponse.json({ message: "Not a session day" });
  }

  // Check if session already exists
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });

  if (existing) {
    return NextResponse.json({ message: "Session already exists" });
  }

  await db.insert(sessions).values({ date: dateStr, status: "voting" });

  return NextResponse.json({ message: `Session created for ${dateStr}` });
}
