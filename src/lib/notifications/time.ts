/**
 * Thời điểm bắt đầu buổi chơi. `date`/`startTime` là giờ VN không lưu múi giờ,
 * nên phải ghim `+07:00` (server Vercel chạy UTC).
 */
export function sessionStartInstant(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00+07:00`);
}

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;

/** Đọc trường UTC của kết quả này là ra giờ VN. */
function vnShift(d: Date): Date {
  return new Date(d.getTime() + VN_OFFSET_MS);
}

/** Ngày lịch VN `YYYY-MM-DD` của thời điểm `d`. */
export function vnDate(d: Date): string {
  return vnShift(d).toISOString().slice(0, 10);
}

/** 00:00 giờ VN của ngày VN chứa `d`. */
export function startOfVNDay(d: Date): Date {
  const v = vnShift(d).getTime();
  return new Date(v - (v % DAY_MS) - VN_OFFSET_MS);
}

/** Giờ yên lặng: từ 22:00 tới trước 07:00 giờ VN. */
export function isQuietHourVN(d: Date): boolean {
  const h = vnShift(d).getUTCHours();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** Mốc 07:00 VN kế tiếp sau `d` (đúng 07:00 thì lấy ngày hôm sau). */
export function nextQuietEndVN(d: Date): Date {
  const end = startOfVNDay(d).getTime() + QUIET_END_HOUR * 3_600_000;
  return new Date(end > d.getTime() ? end : end + DAY_MS);
}
