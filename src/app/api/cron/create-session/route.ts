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
  getSettings,
} from "@/actions/settings";
import { computeDefaultDeadline } from "@/lib/vote-deadline";
import { computeCourtTotal } from "@/lib/cost-calculator";
import type { AppSettings } from "@/lib/settings-registry";

type Court = {
  id: number;
  pricePerSession: number;
  pricePerSessionRetail: number | null;
};
type Brand = { id: number; pricePerTube: number };

/** Tạo 1 session cho `dateStr` nếu chưa tồn tại. Trả về true nếu tạo mới. */
async function createSessionIfMissing(
  dateStr: string,
  defaultCourt: Court | null,
  defaultBrand: Brand | null,
  settings: AppSettings,
  sessionDays: number[],
): Promise<boolean> {
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });
  if (existing) return false;

  // Court price phải chạy qua computeCourtTotal để KHỚP courtQuantity (giống
  // đường tạo buổi thủ công createSessionManually). Lấy pricePerSession trần
  // thì buổi khai N sân mà giá chỉ 1 sân → finalize (dùng thẳng courtPrice) thu
  // thiếu khi admin đặt defaultCourtQuantity > 1. Buổi cron luôn dùng đúng sân
  // mặc định vào ngày chơi → isRegular=true; ở qty=1 kết quả == pricePerSession.
  const courtPrice = defaultCourt
    ? computeCourtTotal({
        monthlyPrice: defaultCourt.pricePerSession,
        retailPrice: defaultCourt.pricePerSessionRetail,
        courtQuantity: settings.defaultCourtQuantity,
        sessionDate: dateStr,
        selectedCourtId: defaultCourt.id,
        defaultCourtId: defaultCourt.id,
        sessionDays,
      })
    : null;

  // onConflictDoNothing trên UNIQUE(date): nếu 2 lần cron chạy trùng (Vercel cron
  // at-least-once, có thể double-fire) cùng chèn 1 ngày, lần thứ 2 KHÔNG ném
  // UNIQUE error (trước đây throw giữa vòng lặp Thứ Bảy → bỏ dở các buổi còn
  // lại của tuần). Conflict → returning [] → coi như đã tồn tại, bỏ qua.
  const [newSession] = await db
    .insert(sessions)
    .values({
      date: dateStr,
      status: "voting",
      startTime: settings.defaultStartTime,
      endTime: settings.defaultEndTime,
      courtQuantity: settings.defaultCourtQuantity,
      maxPlayers: settings.defaultMaxPlayers,
      courtId: defaultCourt?.id ?? null,
      courtPrice,
      useMinDeduction: true,
      voteDeadline: computeDefaultDeadline(
        dateStr,
        settings.defaultStartTime,
        settings.voteDeadlineOffsetHours,
      ),
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

  const settings = await getSettings();
  if (!settings.autoCreateSessions) {
    return NextResponse.json({ skipped: "autoCreateSessions is off" });
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
        settings,
        sessionDaysArr,
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
    settings,
    sessionDaysArr,
  );
  return NextResponse.json({
    message: wasCreated
      ? `Session created for ${dateStr}`
      : "Session already exists",
  });
}
