/**
 * Chuyển mili-giây còn lại → đồng hồ đếm ngược theo GIÂY.
 * - `days` tách riêng (vì `clock` chỉ giữ giờ 0-23 cho gọn).
 * - `clock` = "HH:MM:SS" zero-pad, luôn có giây (tick mỗi giây ở UI).
 * - Âm (đã quá hạn) → clamp về 0 (00:00:00) thay vì số âm.
 */
export function countdownClock(ms: number): { days: number; clock: string } {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor(totalSec / 3_600) % 24;
  const minutes = Math.floor(totalSec / 60) % 60;
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { days, clock: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` };
}
