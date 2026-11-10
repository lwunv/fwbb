import { normalizeVietnamese } from "@/lib/utils";
import { ymdInVN } from "@/lib/date-format";

/**
 * Lọc + gom nhóm cho trang thông báo admin (kiểu Facebook, yêu cầu user
 * 6/11/2026). Hàm thuần, không đụng DB, để test được và dùng ở client.
 */

type Named = { name: string; nickname: string | null };

export type OwingLevelFilter = "all" | "over" | "under";

function matches(item: Named, q: string): boolean {
  const needle = normalizeVietnamese(q.trim());
  if (!needle) return true;
  return (
    normalizeVietnamese(item.name).includes(needle) ||
    normalizeVietnamese(item.nickname ?? "").includes(needle)
  );
}

export function filterOwing<T extends Named & { overLimit: boolean }>(
  items: ReadonlyArray<T>,
  opts: { q: string; level: OwingLevelFilter },
): T[] {
  return items.filter(
    (o) =>
      matches(o, opts.q) &&
      (opts.level === "all" ||
        (opts.level === "over" ? o.overLimit : !o.overLimit)),
  );
}

/** `created_at` SQLite ("YYYY-MM-DD HH:MM:SS") là giờ UTC. */
export function ledgerTimeToDate(at: string): Date {
  return new Date(`${at.replace(" ", "T")}Z`);
}

/** Số ngày lịch (giờ VN) giữa `now` và thời điểm `at`. 0 = cùng ngày. */
function vnDayDiff(at: string, now: Date): number {
  const a = Date.parse(ymdInVN(ledgerTimeToDate(at)));
  const b = Date.parse(ymdInVN(now));
  return Math.round((b - a) / 86_400_000);
}

export function filterHistory<T extends Named & { at: string }>(
  items: ReadonlyArray<T>,
  opts: { q: string; rangeDays: number | null; now: Date },
): T[] {
  return items.filter(
    (x) =>
      matches(x, opts.q) &&
      (opts.rangeDays === null || vnDayDiff(x.at, opts.now) < opts.rangeDays),
  );
}

export type RecencyKey = "today" | "yesterday" | "week" | "earlier";

/** Gom theo ngày giờ VN như Facebook; giữ thứ tự đầu vào, bỏ nhóm rỗng. */
export function groupByRecency<T extends { at: string }>(
  items: ReadonlyArray<T>,
  now: Date,
): Array<{ key: RecencyKey; items: T[] }> {
  const groups: Record<RecencyKey, T[]> = {
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const x of items) {
    const d = vnDayDiff(x.at, now);
    const key: RecencyKey =
      d <= 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? "week" : "earlier";
    groups[key].push(x);
  }
  return (["today", "yesterday", "week", "earlier"] as const)
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ key: k, items: groups[k] }));
}

/**
 * Trang tương ứng với một thông báo âm quỹ: sổ quỹ đã lọc sẵn tên member, nơi
 * thấy cả khoản làm họ âm (yêu cầu user 6/11/2026: bấm thông báo thì chuyển
 * tới trang tương ứng).
 */
export function notificationHref(name: string): string {
  return `/admin/fund/transactions?q=${encodeURIComponent(name)}`;
}

/**
 * Key thông báo âm quỹ MỚI NHẤT của từng member (lịch sử đã sắp mới nhất
 * trước), để dòng "đang nợ" ở chuông biết có tin chưa đọc không.
 */
export function latestCrossingByMember<
  T extends { memberId: number; txId: number; at: string },
>(history: ReadonlyArray<T>): Map<number, T> {
  const out = new Map<number, T>();
  for (const h of history) if (!out.has(h.memberId)) out.set(h.memberId, h);
  return out;
}
