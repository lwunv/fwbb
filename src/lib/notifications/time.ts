/**
 * Thời điểm bắt đầu buổi chơi. `date`/`startTime` là giờ VN không lưu múi giờ,
 * nên phải ghim `+07:00` (server Vercel chạy UTC).
 */
export function sessionStartInstant(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00+07:00`);
}
