// Luật người giới thiệu (G2d, quyết định 40-44). Thuần, không DB: phần đọc dữ
// liệu ở `referral.ts`. Mọi trạng thái tính lại từ dữ liệu đăng ký lúc đọc
// (quyết định 45), nên các hàm này nhận mốc thời gian chứ không lưu cờ.

import {
  REFERRAL_BLOCK_DAYS,
  REFERRAL_MIN_ATTENDED,
  REFERRAL_MIN_RATE_PCT,
  REFERRAL_STRIKES,
  REFERRAL_WATCH_DAYS,
} from "./constants";

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Đủ điều kiện giới thiệu (quyết định 40): tổng số buổi đã đến (giao lưu + nhóm,
 * định nghĩa của quyết định 2) từ 3, và tỉ lệ đến ở buổi giao lưu từ 80%. Chưa
 * có buổi giao lưu nào được duyệt thì coi như đạt điều kiện tỉ lệ. So bằng số
 * nguyên để 80% đúng tuyệt đối (4/5 đạt, 3/4 không).
 */
export function canRefer(s: {
  attendedTotal: number;
  attended: number;
  approvedPast: number;
}): boolean {
  if (s.attendedTotal < REFERRAL_MIN_ATTENDED) return false;
  if (s.approvedPast === 0) return true;
  return 100 * s.attended >= REFERRAL_MIN_RATE_PCT * s.approvedPast;
}

/**
 * Lúc lời giới thiệu bị phá (quyết định 43, 44): lần vắng hoặc huỷ muộn thứ 2
 * nằm trong `[createdAt, createdAt + 30 ngày]`. `null` khi chưa bị phá.
 */
export function referralBrokenAt(
  createdAt: string,
  incidents: string[],
): string | null {
  const start = Date.parse(createdAt);
  const end = start + REFERRAL_WATCH_DAYS * DAY_MS;
  const inside = incidents
    .map((i) => Date.parse(i))
    .filter((ms) => Number.isFinite(ms) && ms >= start && ms <= end)
    .sort((a, b) => a - b);
  const hit = inside[REFERRAL_STRIKES - 1];
  return hit === undefined ? null : new Date(hit).toISOString();
}

/**
 * Người giới thiệu bị khoá tới `brokenAt + 30 ngày` của lần phá muộn nhất, nếu
 * mốc đó còn ở tương lai. Không trừ điểm công khai nào (quyết định 44).
 */
export function referrerBlockedUntil(
  brokenAts: string[],
  now: Date,
): string | null {
  let until = -Infinity;
  for (const b of brokenAts) {
    const ms = Date.parse(b);
    if (Number.isFinite(ms))
      until = Math.max(until, ms + REFERRAL_BLOCK_DAYS * DAY_MS);
  }
  return until > now.getTime() ? new Date(until).toISOString() : null;
}

/**
 * Tháng lịch giờ Việt Nam chứa `now` (quyết định 41): `from` là 00:00 ngày 1
 * tháng này, `to` là 00:00 ngày 1 tháng sau, cả hai ISO UTC. Việt Nam không có
 * giờ mùa hè nên cộng cố định 7 giờ là đúng.
 */
export function vnMonthBounds(now: Date): { from: string; to: string } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  return {
    from: new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS).toISOString(),
    to: new Date(Date.UTC(y, m + 1, 1) - VN_OFFSET_MS).toISOString(),
  };
}
