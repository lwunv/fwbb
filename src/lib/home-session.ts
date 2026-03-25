/** Số ngày (theo lịch) còn lại đến ngày chơi; 0 = hôm nay. */
export function calendarDaysUntilSession(sessionDateYmd: string): number {
  const today = new Date().toISOString().split("T")[0];
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
