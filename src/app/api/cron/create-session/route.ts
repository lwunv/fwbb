import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { addDays, format, getDay } from "date-fns";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if tomorrow is Monday (1) or Friday (5)
  const tomorrow = addDays(new Date(), 1);
  const dayOfWeek = getDay(tomorrow);

  if (dayOfWeek !== 1 && dayOfWeek !== 5) {
    return NextResponse.json({ message: "Not a session day" });
  }

  const dateStr = format(tomorrow, "yyyy-MM-dd");

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
