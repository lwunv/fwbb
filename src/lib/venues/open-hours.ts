/** Một khoảng mở cửa trong ngày, tính bằng phút từ 0h (0..1440). */
export type OpenRange = { start: number; end: number };

export type OpenStatus = "open" | "closed" | "unknown";

const TIME = String.raw`(\d{1,2})(?:[:h.](\d{2}))?h?`;
const RANGE_RE = new RegExp(`^${TIME}\\s*(?:-|–|~|đến)\\s*${TIME}$`);

function toMinutes(h: string, m: string | undefined): number | null {
  const hour = Number(h);
  const min = m === undefined ? 0 : Number(m);
  if (hour > 24 || min > 59) return null;
  if (hour === 24 && min !== 0) return null;
  return hour * 60 + min;
}

/**
 * Giờ mở cửa do người dùng gõ tự do. Chỉ nhận khi CẢ chuỗi là các khoảng giờ;
 * có chữ lạ (thứ trong tuần, "sáng"...) thì trả null để UI ghi "Chưa rõ giờ"
 * thay vì đoán sai thành "Đang mở".
 */
export function parseOpenHours(
  raw: string | null | undefined,
): OpenRange[] | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === "24/7" || s === "24h") return [{ start: 0, end: 1440 }];

  const ranges: OpenRange[] = [];
  for (const part of s.split(/[,;]/)) {
    const match = RANGE_RE.exec(part.trim());
    if (!match) return null;
    const start = toMinutes(match[1], match[2]);
    const end = toMinutes(match[3], match[4]);
    if (start === null || end === null) return null;
    // 24:00 chỉ hợp lệ làm giờ đóng cửa.
    if (start >= 1440 || start === end) return null;
    ranges.push({ start, end });
  }
  return ranges;
}

const VN_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

/** Số phút kể từ 0h theo giờ Việt Nam, bất kể múi giờ của máy. */
export function minutesInVietnam(now: Date): number {
  const parts = VN_TIME.formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

export function openStatus(
  raw: string | null | undefined,
  now: Date,
): OpenStatus {
  const ranges = parseOpenHours(raw);
  if (!ranges) return "unknown";
  const m = minutesInVietnam(now);
  const open = ranges.some((r) =>
    r.end > r.start ? m >= r.start && m < r.end : m >= r.start || m < r.end,
  );
  return open ? "open" : "closed";
}
