// Toán uy tín và điểm sân (G2d). Thuần, không DB, không `server-only`.
// Mọi phép tính dùng số nguyên: trọng số tính theo đơn vị 1/5 lượt (`w5`), điểm
// sân theo 1/10 điểm. Chỉ `formatTenths` đổi sang chữ để hiển thị.

import type { PublicExchangeEvent } from "@/lib/exchange/public-event";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";
import {
  BAYES_VIRTUAL_VOTES,
  FEEDBACK_WINDOW_DAYS,
  HOST_PCT_MIN_RATERS,
  HOST_PCT_STEP,
  MIN_RATERS_PER_EVENT,
  MIN_RATERS_SHOWN,
  PEER_TAGS,
  REVIEW_ANOMALY_MIN_TOTAL,
  REVIEW_BURST_LIMIT,
  VENUE_CRITERIA,
  VENUE_MIN_REVIEWS,
  WEIGHT_FULL_AT,
  type PeerTag,
  type VenueCriterion,
} from "./constants";

const DAY_MS = 86_400_000;
const WINDOW_MS = FEEDBACK_WINDOW_DAYS * DAY_MS;
const VN_TZ = "Asia/Ho_Chi_Minh";

/** Trọng số người chấm theo số buổi đã đến, đơn vị 1/5 lượt (5 = nặng 1). */
export function weight5(attended: number): number {
  if (!Number.isFinite(attended) || attended <= 0) return 0;
  return Math.min(WEIGHT_FULL_AT, Math.floor(attended));
}

/** `num / den` làm tròn nửa lên, chỉ dùng số nguyên (num ≥ 0, den > 0). */
export function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/** Phần trăm nguyên làm tròn nửa lên; `whole <= 0` thì không có số. */
export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return roundHalfUp(100 * part, whole);
}

/** Cửa sổ chấm: từ giờ kết thúc tới đúng 7 ngày sau (tính cả hai đầu). */
export function feedbackWindow(
  endAt: string,
  now: Date,
): "notYet" | "open" | "closed" {
  const end = Date.parse(endAt);
  const t = now.getTime();
  if (t < end) return "notYet";
  if (t <= end + WINDOW_MS) return "open";
  return "closed";
}

/**
 * Buổi đã đóng chấm hay chưa, dùng để quyết định lượt chấm có được cộng vào
 * hồ sơ. Đúng mốc `endAt + 7 ngày` thì đã tính là đóng (cộng sớm 1 ms không
 * lộ ai, còn cửa sổ chấm vẫn mở tới hết mốc đó).
 */
export function windowClosed(endAt: string, now: Date): boolean {
  return now.getTime() >= Date.parse(endAt) + WINDOW_MS;
}

/** Người xem có được mở phiếu chấm buổi này không. */
export function canRate(
  event: Pick<PublicExchangeEvent, "endAt" | "status" | "hidden">,
  my: { checkedIn: boolean } | null,
  now: Date,
): boolean {
  return (
    !!my?.checkedIn &&
    !event.hidden &&
    event.status !== "cancelled" &&
    feedbackWindow(event.endAt, now) === "open"
  );
}

/**
 * Bỏ mọi dòng của buổi có ít hơn `min` người chấm khác nhau. Lý do (C1): buổi
 * chỉ 1-2 người chấm thì so hồ sơ trước và sau là đoán ra ai chấm gì.
 */
export function keepEventsWithRaters<
  T extends { eventId: number; fromId: number },
>(rows: T[], min: number): T[] {
  const raters = new Map<number, Set<number>>();
  for (const r of rows) {
    let set = raters.get(r.eventId);
    if (!set) {
      set = new Set();
      raters.set(r.eventId, set);
    }
    set.add(r.fromId);
  }
  return rows.filter((r) => (raters.get(r.eventId)?.size ?? 0) >= min);
}

/** Mỗi người chấm chỉ giữ dòng mới nhất (`updatedAt`, rồi `id` lớn hơn). */
export function latestPerRater<
  T extends { id: number; fromId: number; updatedAt: string },
>(rows: T[]): T[] {
  const best = new Map<number, T>();
  for (const r of rows) {
    const cur = best.get(r.fromId);
    if (
      !cur ||
      r.updatedAt > cur.updatedAt ||
      (r.updatedAt === cur.updatedAt && r.id > cur.id)
    ) {
      best.set(r.fromId, r);
    }
  }
  return rows.filter((r) => best.get(r.fromId) === r);
}

/**
 * Trung vị có trọng số: mức thấp nhất mà cộng dồn đạt nửa tổng trọng số. Rơi
 * đúng giữa hai mức thì lấy mức thấp hơn (quyết định 10).
 */
export function weightedMedianSkill(
  entries: { level: SkillLevel; w5: number }[],
): SkillLevel | null {
  const byLevel = new Map<SkillLevel, number>();
  let total = 0;
  for (const e of entries) {
    if (!(e.w5 > 0)) continue;
    byLevel.set(e.level, (byLevel.get(e.level) ?? 0) + e.w5);
    total += e.w5;
  }
  if (total === 0) return null;
  let acc = 0;
  for (const level of SKILL_LEVELS) {
    acc += byLevel.get(level) ?? 0;
    if (2 * acc >= total) return level;
  }
  return null;
}

export type PeerRow = {
  id: number;
  eventId: number;
  fromId: number;
  updatedAt: string;
  w5: number;
  playAgain: boolean;
  tags: string[];
  skill: SkillLevel | null;
};

export type PeerSummary = {
  raters: number | null;
  playAgain: number | null;
  tags: { tag: PeerTag; count: number }[];
  skill: { level: SkillLevel; raters: number } | null;
};

const PEER_TAG_SET: ReadonlySet<string> = new Set(PEER_TAGS);

/** Lọc theo buổi rồi theo người chấm; null khi còn dưới ngưỡng hiện. */
export type SummarizeOptions = {
  /**
   * Dòng đã qua bước "buổi có ít nhất `MIN_RATERS_PER_EVENT` người chấm" (SQL
   * của `profile-read.ts` làm trước trần 500 dòng). Bỏ bước đó ở đây: làm lại
   * trên dòng đã cắt trần sẽ tách một buổi ở biên trần (final review M5).
   */
  eventsFiltered?: boolean;
};

function countedRows<
  T extends { id: number; eventId: number; fromId: number; updatedAt: string },
>(rows: T[], opts: SummarizeOptions): T[] | null {
  const perEvent = opts.eventsFiltered
    ? rows
    : keepEventsWithRaters(rows, MIN_RATERS_PER_EVENT);
  const kept = latestPerRater(perEvent);
  return kept.length < MIN_RATERS_SHOWN ? null : kept;
}

/**
 * Tổng hợp lời khen người chơi cùng. Chỉ đếm lượt khen đã nhân trọng số, làm
 * tròn xuống theo lượt đủ nặng; không bấm không phải là chê nên không có phần
 * trăm (quyết định 8).
 */
export function summarizePeer(
  rows: PeerRow[],
  opts: SummarizeOptions = {},
): PeerSummary {
  const kept = countedRows(rows, opts);
  if (!kept) return { raters: null, playAgain: null, tags: [], skill: null };

  let playAgainW = 0;
  const tagW = new Map<PeerTag, number>();
  const skills: { level: SkillLevel; w5: number }[] = [];
  for (const r of kept) {
    if (r.playAgain) playAgainW += r.w5;
    for (const tag of new Set(r.tags)) {
      if (PEER_TAG_SET.has(tag)) {
        const t = tag as PeerTag;
        tagW.set(t, (tagW.get(t) ?? 0) + r.w5);
      }
    }
    if (r.skill) skills.push({ level: r.skill, w5: r.w5 });
  }

  const playAgain = Math.floor(playAgainW / WEIGHT_FULL_AT);
  const tags = PEER_TAGS.map((tag) => ({
    tag,
    count: Math.floor((tagW.get(tag) ?? 0) / WEIGHT_FULL_AT),
  }))
    .filter((t) => t.count > 0)
    // sort ổn định: cùng count thì giữ thứ tự PEER_TAGS.
    .sort((a, b) => b.count - a.count);

  let skill: PeerSummary["skill"] = null;
  if (skills.length >= MIN_RATERS_SHOWN) {
    const level = weightedMedianSkill(skills);
    if (level) skill = { level, raters: skills.length };
  }

  return {
    raters: kept.length,
    playAgain: playAgain > 0 ? playAgain : null,
    tags,
    skill,
  };
}

export type HostRow = {
  id: number;
  eventId: number;
  fromId: number;
  updatedAt: string;
  w5: number;
  asDescribed: boolean;
  feeAsPromised: boolean;
};

/**
 * Phần trăm có trọng số làm tròn XUỐNG bậc `HOST_PCT_STEP` (95% → 90%; 100%
 * chỉ khi mọi lượt đều "có"). Số nguyên từ đầu tới cuối.
 */
export function flooredPercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  const steps = 100 / HOST_PCT_STEP;
  return Math.floor((steps * part) / whole) * HOST_PCT_STEP;
}

/**
 * Phần trăm "đúng như mô tả" và "phí đúng như đã báo", có trọng số. `raters`
 * hiện từ 3 người chấm như mọi chỉ số; phần trăm chỉ hiện từ
 * `HOST_PCT_MIN_RATERS` người và theo bậc 10% để không ai suy ra được câu trả
 * lời của một người chấm (final review I2).
 */
export function summarizeHost(
  rows: HostRow[],
  opts: SummarizeOptions = {},
): {
  raters: number | null;
  asDescribedPct: number | null;
  feeAsPromisedPct: number | null;
} {
  const kept = countedRows(rows, opts);
  if (!kept)
    return { raters: null, asDescribedPct: null, feeAsPromisedPct: null };
  let total = 0;
  let described = 0;
  let fee = 0;
  for (const r of kept) {
    total += r.w5;
    if (r.asDescribed) described += r.w5;
    if (r.feeAsPromised) fee += r.w5;
  }
  const shown = kept.length >= HOST_PCT_MIN_RATERS;
  return {
    raters: kept.length,
    asDescribedPct: shown ? flooredPercent(described, total) : null,
    feeAsPromisedPct: shown ? flooredPercent(fee, total) : null,
  };
}

/** Tổng điểm có trọng số (`Σ w5 * điểm`) theo tiêu chí, `w = Σ w5`. */
export type VenueSums = { count: number; w: number } & Record<
  VenueCriterion,
  number
>;

/** Điểm sân theo 1/10 điểm (43 = 4,3); null khi chưa đủ đánh giá. */
export type VenueScore = {
  count: number;
  overall: number | null;
  criteria: Record<VenueCriterion, number | null>;
};

/** Trung bình chung khi chưa có dữ liệu sân nào. */
const FALLBACK_PRIOR_AVG = 3;

/**
 * Điểm sân kéo về trung bình chung mọi sân bằng `BAYES_VIRTUAL_VOTES` lượt ảo
 * nặng đủ (B = 5 * 5 theo đơn vị w5). Trung bình chung giữ dạng phân số
 * `prior[c] / prior.w` để toàn bộ phép tính là số nguyên.
 */
export function venueScore(venue: VenueSums, prior: VenueSums): VenueScore {
  const criteria = {} as Record<VenueCriterion, number | null>;
  if (venue.count < VENUE_MIN_REVIEWS) {
    for (const c of VENUE_CRITERIA) criteria[c] = null;
    return { count: venue.count, overall: null, criteria };
  }

  const B = BAYES_VIRTUAL_VOTES * WEIGHT_FULL_AT;
  const pw = prior.w > 0 ? prior.w : 1;
  const priorOf = (c: VenueCriterion) =>
    prior.w > 0 ? prior[c] : FALLBACK_PRIOR_AVG;

  let S = 0;
  let P = 0;
  for (const c of VENUE_CRITERIA) {
    criteria[c] = roundHalfUp(
      10 * (venue[c] * pw + B * priorOf(c)),
      (venue.w + B) * pw,
    );
    S += venue[c];
    P += priorOf(c);
  }
  const overall = roundHalfUp(
    10 * (S * pw + B * P),
    VENUE_CRITERIA.length * (venue.w + B) * pw,
  );
  return { count: venue.count, overall, criteria };
}

/** Đánh giá mới có vào hàng chờ vì sân đang bị dồn đánh giá bất thường không. */
export function isReviewAnomalous(x: {
  recent24h: number;
  total: number;
  lowRep: number;
}): boolean {
  return (
    x.recent24h >= REVIEW_BURST_LIMIT ||
    (x.total >= REVIEW_ANOMALY_MIN_TOTAL && 2 * x.lowRep > x.total)
  );
}

/** 43 → "4,3" (vi), "4.3" (en). */
export function formatTenths(tenths: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(tenths / 10);
}

/** Tháng `YYYY-MM` theo giờ Việt Nam; trang công khai chỉ hiện tới tháng. */
export function vnMonth(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}-${month}`;
}
