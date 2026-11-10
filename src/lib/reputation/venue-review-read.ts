import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import type { DbOrTx } from "@/db/tx";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import {
  PRIOR_REVALIDATE_S,
  REVIEW_MAX_OFFSET,
  REVIEW_PAGE_SIZE,
  VENUE_CRITERIA,
  VENUE_MIN_REVIEWS,
  VENUE_REVIEWS_TAG,
  venueReviewTag,
  type VenueCriterion,
} from "./constants";
import { venueScore, vnMonth, type VenueScore, type VenueSums } from "./score";

/** Tổng và trang của một sân sống tối đa 10 phút nếu không có `updateTag`. */
const VENUE_REVALIDATE_S = 600;

/** Một đánh giá trên trang công khai: không người viết, không mốc giờ (I2b). */
export type VenueReviewView = {
  id: number;
  scores: Record<VenueCriterion, number>;
  comment: string | null;
  /** `YYYY-MM` theo giờ Việt Nam, tính ở server. */
  month: string;
  edited: boolean;
};

export type VenueReviewPage = {
  reviews: VenueReviewView[];
  hasMore: boolean;
  nextOffset: number | null;
};

const COLUMN: Record<VenueCriterion, string> = {
  surface: "score_surface",
  lighting: "score_lighting",
  ventilation: "score_ventilation",
  price: "score_price",
  parking: "score_parking",
  owner: "score_owner",
};

/** Tài khoản người viết còn hiệu lực: khoá hay từ chối thì đánh giá rơi khỏi điểm và trang. */
const ACTIVE_AUTHOR = sql.raw(
  "m.is_active = 1 AND m.approval_status <> 'rejected'",
);

/**
 * Tổng có trọng số của một sân. Đi từ `venues` theo khoá chính rồi
 * `venue_reviews (venue_id, status)` nên không quét bảng. Sân không `approved`
 * thì không có dòng nào (I10); điều kiện tài khoản nằm trong từng `CASE` để sân
 * chỉ có đánh giá của nick bị khoá vẫn ra một dòng đếm 0.
 */
export function venueSumsQuery(venueId: number): SQL {
  const ok = sql`(${ACTIVE_AUTHOR})`;
  const sums = VENUE_CRITERIA.map(
    (c) =>
      sql`COALESCE(SUM(CASE WHEN ${ok} THEN r.rater_weight * r.${sql.raw(COLUMN[c])} ELSE 0 END), 0) AS ${sql.raw(c)}`,
  );
  return sql`SELECT
      COALESCE(SUM(CASE WHEN ${ok} THEN 1 ELSE 0 END), 0) AS count,
      COALESCE(SUM(CASE WHEN ${ok} THEN r.rater_weight ELSE 0 END), 0) AS w,
      ${sql.join(sums, sql`, `)}
    FROM venues v
    LEFT JOIN venue_reviews r ON r.venue_id = v.id AND r.status = 'visible'
    LEFT JOIN members m ON m.id = r.member_id
    WHERE v.id = ${venueId} AND v.status = 'approved'
    GROUP BY v.id`;
}

/** Trung bình chung mọi sân `approved`: quét cả bảng nên chỉ chạy mỗi giờ (I6). */
export function priorSumsQuery(): SQL {
  const sums = VENUE_CRITERIA.map(
    (c) =>
      sql`COALESCE(SUM(r.rater_weight * r.${sql.raw(COLUMN[c])}), 0) AS ${sql.raw(c)}`,
  );
  return sql`SELECT COUNT(*) AS count,
      COALESCE(SUM(r.rater_weight), 0) AS w,
      ${sql.join(sums, sql`, `)}
    FROM venue_reviews r
    JOIN venues v ON v.id = r.venue_id
    JOIN members m ON m.id = r.member_id
    WHERE r.status = 'visible' AND v.status = 'approved' AND ${ACTIVE_AUTHOR}`;
}

/** Một trang đánh giá, lấy dư 1 dòng để biết còn trang sau không. */
export function venueReviewPageQuery(venueId: number, offset: number): SQL {
  return sql`SELECT r.id, r.score_surface, r.score_lighting, r.score_ventilation,
      r.score_price, r.score_parking, r.score_owner, r.comment, r.created_at,
      r.edited_at IS NOT NULL AS edited
    FROM venue_reviews r
    JOIN venues v ON v.id = r.venue_id
    JOIN members m ON m.id = r.member_id
    WHERE r.venue_id = ${venueId} AND r.status = 'visible'
      AND v.status = 'approved' AND ${ACTIVE_AUTHOR}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${REVIEW_PAGE_SIZE + 1} OFFSET ${offset}`;
}

type SumsRow = { count: number; w: number } & Record<VenueCriterion, number>;

function toSums(row: SumsRow): VenueSums {
  const out = { count: Number(row.count), w: Number(row.w) } as VenueSums;
  for (const c of VENUE_CRITERIA) out[c] = Number(row[c]);
  return out;
}

export async function loadVenueSums(
  dbx: DbOrTx,
  venueId: number,
): Promise<VenueSums | null> {
  const [row] = await dbx.all<SumsRow>(venueSumsQuery(venueId));
  return row ? toSums(row) : null;
}

export async function loadPriorSums(dbx: DbOrTx): Promise<VenueSums> {
  const [row] = await dbx.all<SumsRow>(priorSumsQuery());
  return toSums(row);
}

type PageRow = {
  id: number;
  score_surface: number;
  score_lighting: number;
  score_ventilation: number;
  score_price: number;
  score_parking: number;
  score_owner: number;
  comment: string | null;
  created_at: string;
  edited: number;
};

export async function loadVenueReviewPage(
  dbx: DbOrTx,
  venueId: number,
  offset: number,
): Promise<VenueReviewPage> {
  const rows = await dbx.all<PageRow>(venueReviewPageQuery(venueId, offset));
  // Whitelist từng trường: không spread dòng DB ra payload công khai.
  const reviews = rows.slice(0, REVIEW_PAGE_SIZE).map(
    (r): VenueReviewView => ({
      id: Number(r.id),
      scores: {
        surface: Number(r.score_surface),
        lighting: Number(r.score_lighting),
        ventilation: Number(r.score_ventilation),
        price: Number(r.score_price),
        parking: Number(r.score_parking),
        owner: Number(r.score_owner),
      },
      comment: r.comment,
      month: vnMonth(r.created_at),
      edited: Boolean(r.edited),
    }),
  );
  const next = offset + REVIEW_PAGE_SIZE;
  const nextOffset =
    rows.length > REVIEW_PAGE_SIZE && next <= REVIEW_MAX_OFFSET ? next : null;
  return { reviews, hasMore: nextOffset !== null, nextOffset };
}

const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

const EMPTY_PAGE: VenueReviewPage = {
  reviews: [],
  hasMore: false,
  nextOffset: null,
};

/**
 * Ném trong hàm được cache khi sân không tồn tại hoặc không `approved`:
 * `unstable_cache` không lưu lần ném, nên bot gọi id bừa không làm phình Data
 * Cache bằng các mục rỗng (mỗi id × mỗi offset).
 */
class VenueNotListed extends Error {}

async function isListedVenue(dbx: DbOrTx, venueId: number): Promise<boolean> {
  const rows = await dbx.all<{ ok: number }>(
    sql`SELECT 1 AS ok FROM venues WHERE id = ${venueId} AND status = 'approved'`,
  );
  return rows.length > 0;
}

/**
 * Điểm sân cho trang chi tiết. Cờ tắt hoặc sân không `approved` → null. Tổng
 * của sân theo tag `vrev:v{id}` (đánh giá mới xoá ngay); trung bình chung theo
 * `vrev:all`, chỉ làm mới mỗi giờ và khi admin ẩn/hiện sân. Ghép ngoài cache
 * để hai bộ nhớ đệm sống độc lập.
 */
export async function getVenueReviewSummary(
  venueId: number,
): Promise<VenueScore | null> {
  if (!(await isExchangeEnabled())) return null;
  if (!validId(venueId)) return null;
  let sums: VenueSums;
  try {
    sums = await unstable_cache(
      async () => {
        // Không có dòng = sân không tồn tại hoặc không approved: không cache.
        const s = await loadVenueSums(db, venueId);
        if (!s) throw new VenueNotListed();
        return s;
      },
      ["vrev-sum", String(venueId)],
      { tags: [venueReviewTag(venueId)], revalidate: VENUE_REVALIDATE_S },
    )();
  } catch (e) {
    if (e instanceof VenueNotListed) return null;
    throw e;
  }
  // Dưới ngưỡng thì không cần trung bình chung: đỡ một lượt đọc quét bảng.
  if (sums.count < VENUE_MIN_REVIEWS) return venueScore(sums, sums);
  const prior = await unstable_cache(() => loadPriorSums(db), ["vrev-prior"], {
    tags: [VENUE_REVIEWS_TAG],
    revalidate: PRIOR_REVALIDATE_S,
  })();
  return venueScore(sums, prior);
}

/**
 * Một trang đánh giá đang hiện của sân. Không kiểm cờ: người gọi (action
 * `listVenueReviews`, trang sân) kiểm trước. `offset` phải đã qua zod.
 *
 * Lần đọc chưa có cache kiểm sân trước (một dòng theo khoá chính): sân không
 * tồn tại hoặc không `approved` trả trang rỗng mà không lưu cache. Lần trúng
 * cache vẫn không đọc DB.
 */
export async function getVenueReviewPage(
  venueId: number,
  offset: number,
): Promise<VenueReviewPage> {
  if (!validId(venueId)) return EMPTY_PAGE;
  try {
    return await unstable_cache(
      async () => {
        if (!(await isListedVenue(db, venueId))) throw new VenueNotListed();
        return loadVenueReviewPage(db, venueId, offset);
      },
      ["vrev-page", String(venueId), String(offset)],
      { tags: [venueReviewTag(venueId)], revalidate: VENUE_REVALIDATE_S },
    )();
  } catch (e) {
    if (e instanceof VenueNotListed) return { ...EMPTY_PAGE };
    throw e;
  }
}
