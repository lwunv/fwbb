import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, sessionShuttlecocks } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  ymdInVN,
  ymdInVNAddDays,
  dayOfWeekVN,
  badmintonDatesForTargetWeek,
} from "@/lib/date-format";
import {
  getDefaultCourt,
  getDefaultBrand,
  getSessionDaysOfWeek,
} from "@/actions/settings";
import {
  computeDefaultDeadline,
  DEFAULT_PLAY_START_TIME,
} from "@/lib/vote-deadline";

type Court = { id: number; pricePerSession: number };
type Brand = { id: number; pricePerTube: number };

/** Tạo 1 session cho `dateStr` nếu chưa tồn tại. Trả về true nếu tạo mới. */
async function createSessionIfMissing(
  dateStr: string,
  defaultCourt: Court | null,
  defaultBrand: Brand | null,
): Promise<boolean> {
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });
  if (existing) return false;

  // onConflictDoNothing trên UNIQUE(date): nếu 2 lần cron chạy trùng (Vercel cron
  // at-least-once, có thể double-fire) cùng chèn 1 ngày, lần thứ 2 KHÔNG ném
  // UNIQUE error (trước đây throw giữa vòng lặp Thứ Bảy → bỏ dở các buổi còn
  // lại của tuần). Conflict → returning [] → coi như đã tồn tại, bỏ qua.
  const [newSession] = await db
    .insert(sessions)
    .values({
      date: dateStr,
      status: "voting",
      courtId: defaultCourt?.id ?? null,
      courtPrice: defaultCourt?.pricePerSession ?? null,
      useMinDeduction: true,
      voteDeadline: computeDefaultDeadline(dateStr, DEFAULT_PLAY_START_TIME),
    })
    .onConflictDoNothing({ target: sessions.date })
    .returning();
  if (!newSession) return false;

  if (defaultBrand) {
    await db.insert(sessionShuttlecocks).values({
      sessionId: newSession.id,
      brandId: defaultBrand.id,
      quantityUsed: 1,
      pricePerTube: defaultBrand.pricePerTube,
    });
  }
  return true;
}

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

  const sessionDaysArr = await getSessionDaysOfWeek();
  const [defaultCourt, defaultBrand] = await Promise.all([
    getDefaultCourt(),
    getDefaultBrand(),
  ]);

  const todayVN = ymdInVN();

  // Thứ Bảy: mở sẵn CẢ 3 buổi (T2/4/6) của tuần KẾ TIẾP cùng lúc, thay vì chờ
  // tạo từng buổi 1 ngày trước như bình thường — user vote được nguyên tuần
  // ngay từ cuối tuần trước đó (quyết định 2026-07-06). Logic ngày-trước-1-
  // ngày ở nhánh else vẫn giữ nguyên làm fallback cho các ngày còn lại (an
  // toàn nếu lần chạy Thứ Bảy vì lý do gì đó bị miss).
  if (dayOfWeekVN(todayVN) === 6) {
    const targetWeekDates = badmintonDatesForTargetWeek(
      todayVN,
      sessionDaysArr,
    );
    const created: string[] = [];
    for (const dateStr of targetWeekDates) {
      const wasCreated = await createSessionIfMissing(
        dateStr,
        defaultCourt,
        defaultBrand,
      );
      if (wasCreated) created.push(dateStr);
    }
    return NextResponse.json({
      message:
        created.length > 0
          ? `Opened next week's sessions: ${created.join(", ")}`
          : "Next week's sessions already existed",
    });
  }

  // Ngày thường: tạo buổi của NGÀY MAI (ở giờ VN — tránh ranh giới ngày bị
  // lệch khi server chạy UTC), giữ nguyên hành vi cũ.
  const dateStr = ymdInVNAddDays(1);
  const sessionDays = new Set(sessionDaysArr);
  if (!sessionDays.has(dayOfWeekVN(dateStr))) {
    return NextResponse.json({ message: "Not a session day" });
  }

  const wasCreated = await createSessionIfMissing(
    dateStr,
    defaultCourt,
    defaultBrand,
  );
  return NextResponse.json({
    message: wasCreated
      ? `Session created for ${dateStr}`
      : "Session already exists",
  });
}
