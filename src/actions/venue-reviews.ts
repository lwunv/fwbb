"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { venueReviews, venues } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import type { AppLocale } from "@/lib/date-fns-locale";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import { checkBotAndRate, exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import { requireExchangeMember } from "@/lib/member-auth";
import { isNotificationsEnabled } from "@/lib/notifications/notify";
import { notifyVenueReviewHeld } from "@/lib/notifications/venue-reviews";
import {
  REVIEW_ANOMALY_WINDOW_DAYS,
  REVIEW_COMMENT_MAX,
  REVIEW_DOUBLE_SUBMIT_MS,
  REVIEW_EDIT_COOLDOWN_DAYS,
  REVIEW_LOW_REP_BELOW,
  REVIEW_MAX_OFFSET,
  REVIEW_PAGE_SIZE,
  RL_REVIEW,
  TS_REVIEW,
  VENUE_CRITERIA,
  venueReviewTag,
  type ReviewHoldReason,
  type VenueCriterion,
  type VenueReviewStatus,
} from "@/lib/reputation/constants";
import {
  raterWeight5,
  venueReviewEligible,
} from "@/lib/reputation/eligibility";
import {
  checkReviewText,
  normalizeReviewComment,
} from "@/lib/reputation/review-text";
import { isReviewAnomalous, vnMonth } from "@/lib/reputation/score";
import {
  getVenueReviewPage,
  type VenueReviewPage,
} from "@/lib/reputation/venue-review-read";

// Chỉ export action tự kiểm quyền: người viết luôn lấy từ cookie phiên, input
// không có memberId. Ghi xong chỉ làm mới tag của đúng sân này; trung bình chung
// mọi sân tự làm mới theo giờ (I6, quyết định 24).

const DAY_MS = 86_400_000;
const EDIT_COOLDOWN_MS = REVIEW_EDIT_COOLDOWN_DAYS * DAY_MS;

type Scores = Record<VenueCriterion, number>;

export type MyVenueReview = {
  eligible: boolean;
  review: {
    id: number;
    scores: Scores;
    comment: string | null;
    status: VenueReviewStatus;
    holdReason: ReviewHoldReason | null;
    /** `YYYY-MM` giờ VN. */
    month: string;
    editedAt: string | null;
  } | null;
  /** Mốc ISO được sửa lại; null = sửa được ngay (hoặc chưa có đánh giá). */
  nextEditAt: string | null;
};

type MyResult = { success: true; data: MyVenueReview } | { error: string };
type SubmitResult =
  | { success: true; data: { id: number; status: VenueReviewStatus } }
  | { error: string };

const venueIdSchema = z.number().int().positive();

const score = z.number().int().min(1).max(5);
const submitSchema = z.object({
  venueId: venueIdSchema,
  // Cả 6 tiêu chí bắt buộc (quyết định 22); khoá lạ bị từ chối.
  scores: z
    .object({
      surface: score,
      lighting: score,
      ventilation: score,
      price: score,
      parking: score,
      owner: score,
    })
    .strict(),
  comment: z
    .string()
    .max(REVIEW_COMMENT_MAX * 4)
    .nullish()
    .transform((s) => normalizeReviewComment(s ?? ""))
    .pipe(z.string().max(REVIEW_COMMENT_MAX))
    .transform((s) => (s === "" ? null : s)),
  idempotencyKey: z.string().uuid(),
  turnstileToken: z.string().min(1).max(4096),
});

const COLUMN: Record<
  VenueCriterion,
  | "scoreSurface"
  | "scoreLighting"
  | "scoreVentilation"
  | "scorePrice"
  | "scoreParking"
  | "scoreOwner"
> = {
  surface: "scoreSurface",
  lighting: "scoreLighting",
  ventilation: "scoreVentilation",
  price: "scorePrice",
  parking: "scoreParking",
  owner: "scoreOwner",
};

type ReviewRow = typeof venueReviews.$inferSelect;

function scoresOf(row: ReviewRow): Scores {
  return Object.fromEntries(
    VENUE_CRITERIA.map((c) => [c, row[COLUMN[c]]]),
  ) as Scores;
}

/** Mốc được sửa tiếp, hoặc null khi sửa được ngay (lần sửa đầu, hoặc đã đủ 30 ngày). */
function nextEditAt(row: ReviewRow, now: Date): string | null {
  if (!row.editedAt) return null;
  const at = Date.parse(row.editedAt) + EDIT_COOLDOWN_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
}

async function approvedVenue(q: DbOrTx, venueId: number) {
  const [v] = await q
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(eq(venues.id, venueId), eq(venues.status, "approved")))
    .limit(1);
  return v ?? null;
}

async function myRow(
  q: DbOrTx,
  venueId: number,
  memberId: number,
): Promise<ReviewRow | null> {
  const [row] = await q
    .select()
    .from(venueReviews)
    .where(
      and(
        eq(venueReviews.venueId, venueId),
        eq(venueReviews.memberId, memberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Lần gửi cũ cùng khoá ở sân còn `approved` (khoá unique sân + người). Chỉ đọc;
 * đứng trước Turnstile để gửi lại sau khi mất phản hồi (token đã dùng) vẫn nhận
 * kết quả cũ, không tốn lượt rate limit.
 */
async function replayOf(
  q: DbOrTx,
  venueId: number,
  memberId: number,
  idempotencyKey: string,
): Promise<{ id: number; status: VenueReviewStatus } | null> {
  const [row] = await q
    .select({ id: venueReviews.id, status: venueReviews.status })
    .from(venueReviews)
    .innerJoin(venues, eq(venues.id, venueReviews.venueId))
    .where(
      and(
        eq(venueReviews.venueId, venueId),
        eq(venueReviews.memberId, memberId),
        eq(venueReviews.idempotencyKey, idempotencyKey),
        eq(venues.status, "approved"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Luật bất thường cho đánh giá MỚI (quyết định 27). `recent24h` đếm mọi dòng
 * chưa ẩn của sân tạo trong 24 giờ; luật quá nửa chỉ đếm dòng `visible` của 90
 * ngày (I9), nên đánh giá đang chờ không kẹt sân mãi. "Nick dưới 3 buổi" đọc
 * từ `rater_weight` đã chụp lúc viết (w5 = số buổi, chặn ở 5). Cả hai câu đi
 * theo `venue_reviews_venue_status_created_idx`.
 */
async function anomalous(
  tx: DbOrTx,
  venueId: number,
  w5: number,
  now: Date,
): Promise<boolean> {
  const since24h = new Date(now.getTime() - DAY_MS).toISOString();
  const since90d = new Date(
    now.getTime() - REVIEW_ANOMALY_WINDOW_DAYS * DAY_MS,
  ).toISOString();
  const [burst] = await tx
    .select({ n: sql<number>`COUNT(*)` })
    .from(venueReviews)
    .where(
      and(
        eq(venueReviews.venueId, venueId),
        inArray(venueReviews.status, ["visible", "held"]),
        gte(venueReviews.createdAt, since24h),
      ),
    );
  const [rep] = await tx
    .select({
      total: sql<number>`COUNT(*)`,
      low: sql<number>`COALESCE(SUM(CASE WHEN ${venueReviews.raterWeight} < ${REVIEW_LOW_REP_BELOW} THEN 1 ELSE 0 END), 0)`,
    })
    .from(venueReviews)
    .where(
      and(
        eq(venueReviews.venueId, venueId),
        eq(venueReviews.status, "visible"),
        gte(venueReviews.createdAt, since90d),
      ),
    );
  // Cộng chính đánh giá đang gửi.
  return isReviewAnomalous({
    recent24h: Number(burst?.n ?? 0) + 1,
    total: Number(rep?.total ?? 0) + 1,
    lowRep: Number(rep?.low ?? 0) + (w5 < REVIEW_LOW_REP_BELOW ? 1 : 0),
  });
}

export async function getMyVenueReview(venueId: number): Promise<MyResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = venueIdSchema.safeParse(venueId);
  if (!parsed.success) return { error: t("invalidInput") };

  const venue = await approvedVenue(db, parsed.data);
  if (!venue) return { error: t("reviewVenueNotFound") };

  const now = new Date();
  const eligible = await venueReviewEligible(db, venue.id, member.id);
  const row = await myRow(db, venue.id, member.id);
  return {
    success: true,
    data: {
      eligible,
      review: row
        ? {
            id: row.id,
            scores: scoresOf(row),
            comment: row.comment,
            status: row.status,
            holdReason: row.holdReason,
            month: vnMonth(row.createdAt),
            editedAt: row.editedAt,
          }
        : null,
      nextEditAt: row ? nextEditAt(row, now) : null,
    },
  };
}

export async function submitVenueReview(input: unknown): Promise<SubmitResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const replay = await replayOf(db, f.venueId, member.id, f.idempotencyKey);
  if (replay) return { success: true, data: replay };

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_REVIEW,
    rateKey: `venue-review:${member.id}`,
    limit: RL_REVIEW.limit,
    windowMs: RL_REVIEW.windowMs,
  });
  if ("error" in bot) return bot;

  // Ngày hiển thị trong lỗi "sửa quá sớm"; đọc ngoài transaction.
  const locale = (await getLocale()) as AppLocale;
  let result: SubmitResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SubmitResult> => {
        const notifyOn = await isNotificationsEnabled(tx);
        const venue = await approvedVenue(tx, f.venueId);
        if (!venue) return { error: t("reviewVenueNotFound") };

        const old = await myRow(tx, venue.id, member.id);
        // Hai tab cùng khoá: tab sau thấy dòng của tab trước ở đây.
        if (old && old.idempotencyKey === f.idempotencyKey)
          return { success: true, data: { id: old.id, status: old.status } };

        if (!(await venueReviewEligible(tx, venue.id, member.id)))
          return { error: t("reviewNotEligible") };

        const now = new Date();
        const stamp = now.toISOString();
        // null khi viết mới, hoặc khi tab thứ hai gửi lần đầu trong 1 phút.
        let editedAt: string | null = null;
        if (old) {
          if (old.status === "hidden") return { error: t("reviewHidden") };
          const next = nextEditAt(old, now);
          if (next) {
            const date = formatSessionDate(
              ymdInVN(new Date(next)),
              "long",
              locale,
            );
            return { error: t("reviewEditTooSoon", { date }) };
          }
          const doubleFirst =
            !old.editedAt &&
            now.getTime() - Date.parse(old.createdAt) < REVIEW_DOUBLE_SUBMIT_MS;
          editedAt = doubleFirst ? null : stamp;
        }

        const w5 = await raterWeight5(tx, member.id);
        let status: VenueReviewStatus = "visible";
        let holdReason: ReviewHoldReason | null = null;
        const text = f.comment ? checkReviewText(f.comment) : null;
        if (old?.status === "held" && old.holdReason === "anomaly") {
          // Xét trước nội dung: nếu lý do đổi sang "contact"/"banned" thì một
          // lần sửa sạch sau đó sẽ hiện được, tức rửa được cờ bất thường. Admin
          // vẫn đọc nội dung khi duyệt nên giữ nguyên "anomaly".
          status = "held";
          holdReason = "anomaly";
        } else if (text?.hold) {
          status = "held";
          holdReason = text.reason;
        } else if (!old) {
          if (await anomalous(tx, venue.id, w5, now)) {
            status = "held";
            holdReason = "anomaly";
          }
        }

        const values = {
          scoreSurface: f.scores.surface,
          scoreLighting: f.scores.lighting,
          scoreVentilation: f.scores.ventilation,
          scorePrice: f.scores.price,
          scoreParking: f.scores.parking,
          scoreOwner: f.scores.owner,
          comment: f.comment,
          status,
          holdReason,
          raterWeight: w5,
          idempotencyKey: f.idempotencyKey,
          updatedAt: stamp,
        };
        let id: number;
        if (old) {
          // reportCount và createdAt giữ nguyên.
          await tx
            .update(venueReviews)
            .set({ ...values, editedAt })
            .where(eq(venueReviews.id, old.id));
          id = old.id;
        } else {
          const [row] = await tx
            .insert(venueReviews)
            .values({
              ...values,
              venueId: venue.id,
              memberId: member.id,
              createdAt: stamp,
              editedAt: null,
            })
            .returning({ id: venueReviews.id });
          id = row.id;
        }

        if (status === "held")
          await notifyVenueReviewHeld(
            tx,
            { venueId: venue.id, venueName: venue.name },
            notifyOn,
            now,
          );
        return { success: true, data: { id, status } };
      }),
    );
  } catch {
    console.error("[Reputation] review_failed", { venueId: f.venueId });
    return { error: t("reviewSaveFailed") };
  }

  if ("success" in result) updateTag(venueReviewTag(f.venueId));
  return result;
}

const listSchema = z.object({
  // Số nguyên an toàn: id ngoài khoảng này không thể là sân thật.
  venueId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  offset: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_MAX_OFFSET)
    .multipleOf(REVIEW_PAGE_SIZE),
});

/**
 * Trang đánh giá công khai của một sân (khách gọi được). Cờ trước mọi thứ,
 * rồi zod, rồi cache. Sân ẩn hay chờ duyệt cho trang rỗng (I10).
 */
export async function listVenueReviews(
  input: unknown,
): Promise<{ success: true; data: VenueReviewPage } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations("exchange.errors");
    return { error: t("invalidInput") };
  }
  const { venueId, offset } = parsed.data;
  return { success: true, data: await getVenueReviewPage(venueId, offset) };
}
