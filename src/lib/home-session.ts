import { ymdInVN } from "@/lib/date-format";

/** Số ngày (theo lịch) còn lại đến ngày chơi; 0 = hôm nay. */
export function calendarDaysUntilSession(sessionDateYmd: string): number {
  // Ngày "hôm nay" theo giờ VN — sessionDateYmd cũng là ngày VN. Dùng
  // toISOString() (UTC) sẽ lệch 1 ngày trong 00:00-07:00 VN.
  const today = ymdInVN();
  const start = new Date(`${today}T12:00:00`);
  const end = new Date(`${sessionDateYmd}T12:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/** Vote + buổi sắp tới: trong vòng N ngày trước ngày chơi (kể cả ngày chơi). */
export const HOME_VOTE_WINDOW_DAYS = 2;

export function isWithinHomeVoteWindow(sessionDateYmd: string): boolean {
  const d = calendarDaysUntilSession(sessionDateYmd);
  return d >= 0 && d <= HOME_VOTE_WINDOW_DAYS;
}
