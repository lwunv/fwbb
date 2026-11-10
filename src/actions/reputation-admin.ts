"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import {
  abuseReports,
  hostFlagReviews,
  members,
  venueReviews,
  venues,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { LIST_LIMIT } from "@/lib/exchange/constants";
import { exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import {
  HOST_FLAG_ROW_CAP,
  HOST_FLAG_WINDOW_DAYS,
  type ReviewHoldReason,
  type VenueCriterion,
  type VenueReviewStatus,
  VENUE_REVIEWS_TAG,
  venueReviewTag,
} from "@/lib/reputation/constants";
import { hostFlagRowsQuery } from "@/lib/reputation/host-flag-rows";
import { findCaptiveHosts } from "@/lib/reputation/host-flags";

// Tab Uy tín của admin. Mọi export là endpoint POST nên mỗi hàm tự kiểm: cờ,
// rồi admin từ cookie phiên, rồi zod (thứ tự G2b). Danh sách chỉ có tên, mã
// hồ sơ, tên sân và số đếm; không sđt, email hay IP của ai. Cờ host chỉ để
// admin xem, không tự phạt ai (quyết định 34).

type Result<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { error: string };

export type AdminVenueReviewRow = {
  id: number;
  venueId: number;
  venueName: string;
  authorName: string;
  scores: Record<VenueCriterion, number>;
  comment: string | null;
  status: VenueReviewStatus;
  holdReason: ReviewHoldReason | null;
  /** Số báo cáo mở của người "đã quen" (cột `report_count`, dùng cho tự ẩn). */
  reportCount: number;
  /** Mọi báo cáo `open` đang nhắm vào đánh giá này. */
  openReports: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminHostFlagRow = {
  hostMemberId: number;
  hostName: string;
  hostCode: string | null;
  captives: number;
  events: number;
  /** Số khách quen lúc admin bấm "Đã xem" lần gần nhất; null khi chưa xem. */
  reviewedCaptives: number | null;
};

const reviewFilterSchema = z.enum(["held", "hidden", "reported"]);
const moderateSchema = z.object({
  reviewId: z.number().int().positive(),
  action: z.enum(["approve", "unhide", "hide", "dismiss"]),
});
// Không `.strict()`: trường thừa (ví dụ `captives` client gửi) bị bỏ, server tự đếm.
const reviewFlagSchema = z.object({
  hostMemberId: z.number().int().positive(),
});

/** Cờ, rồi admin; trả `{ error }` đã dịch hoặc null khi qua. */
async function gateAdmin(): Promise<{ error: string } | null> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  return null;
}

/** Cờ, rồi admin, rồi zod. */
async function guard<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Promise<{ data: z.infer<S> } | { error: string }> {
  const denied = await gateAdmin();
  if (denied) return denied;
  const t = await getTranslations("exchange.errors");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  return { data: parsed.data };
}

const openReviewReports = () =>
  and(eq(abuseReports.targetType, "review"), eq(abuseReports.status, "open"));

const reviewColumns = {
  id: venueReviews.id,
  venueId: venueReviews.venueId,
  venueName: venues.name,
  authorName: members.name,
  surface: venueReviews.scoreSurface,
  lighting: venueReviews.scoreLighting,
  ventilation: venueReviews.scoreVentilation,
  price: venueReviews.scorePrice,
  parking: venueReviews.scoreParking,
  owner: venueReviews.scoreOwner,
  comment: venueReviews.comment,
  status: venueReviews.status,
  holdReason: venueReviews.holdReason,
  reportCount: venueReviews.reportCount,
  createdAt: venueReviews.createdAt,
  updatedAt: venueReviews.updatedAt,
};

const selectReviews = () =>
  db
    .select(reviewColumns)
    .from(venueReviews)
    .innerJoin(venues, eq(venues.id, venueReviews.venueId))
    .innerJoin(members, eq(members.id, venueReviews.memberId));
type ReviewSelect = Awaited<ReturnType<typeof selectReviews>>[number];

function toReviewRow(
  r: ReviewSelect,
  openReports: number,
): AdminVenueReviewRow {
  return {
    id: r.id,
    venueId: r.venueId,
    venueName: r.venueName,
    authorName: r.authorName,
    scores: {
      surface: r.surface,
      lighting: r.lighting,
      ventilation: r.ventilation,
      price: r.price,
      parking: r.parking,
      owner: r.owner,
    },
    comment: r.comment,
    status: r.status,
    holdReason: r.holdReason,
    reportCount: r.reportCount,
    openReports,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Đánh giá sân cho admin: `held`/`hidden` mới đổi trước, `reported` sắp ngay
 * trong SQL theo số báo cáo mở (rồi id mới trước) trước khi cắt 50 dòng, để
 * đánh giá bị báo nhiều nhất không bao giờ rơi khỏi danh sách.
 */
export async function adminListVenueReviews(
  filter: unknown,
): Promise<Result<AdminVenueReviewRow[]>> {
  const g = await guard(reviewFilterSchema, filter);
  if ("error" in g) return g;

  if (g.data === "reported") {
    const open = db
      .select({
        reviewId: sql<number>`${abuseReports.targetId}`.as("review_id"),
        n: sql<number>`count(*)`.as("n"),
      })
      .from(abuseReports)
      .where(openReviewReports())
      .groupBy(abuseReports.targetId)
      .as("open_reports");
    const rows = await db
      .select({ ...reviewColumns, openReports: open.n })
      .from(open)
      .innerJoin(venueReviews, eq(venueReviews.id, open.reviewId))
      .innerJoin(venues, eq(venues.id, venueReviews.venueId))
      .innerJoin(members, eq(members.id, venueReviews.memberId))
      .orderBy(desc(open.n), desc(venueReviews.id))
      .limit(LIST_LIMIT);
    return {
      success: true,
      data: rows.map(({ openReports, ...r }) =>
        toReviewRow(r, Number(openReports)),
      ),
    };
  }

  const rows = await selectReviews()
    .where(eq(venueReviews.status, g.data))
    .orderBy(desc(venueReviews.updatedAt), desc(venueReviews.id))
    .limit(LIST_LIMIT);
  // Số báo cáo mở của các dòng đang hiện: một GROUP BY, không N+1.
  const counts = rows.length
    ? await db
        .select({ id: abuseReports.targetId, n: sql<number>`count(*)` })
        .from(abuseReports)
        .where(
          and(
            openReviewReports(),
            inArray(
              abuseReports.targetId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .groupBy(abuseReports.targetId)
    : [];
  const nById = new Map(counts.map((c) => [c.id, Number(c.n)]));
  return {
    success: true,
    data: rows.map((r) => toReviewRow(r, nById.get(r.id) ?? 0)),
  };
}

/**
 * Admin kiểm duyệt một đánh giá sân. Mỗi hành động đòi đúng trạng thái xuất
 * phát (approve: held, unhide: hidden, hide: visible|held) để bấm lặp trả
 * `reviewNotFound` thay vì ghi lại. Bỏ ẩn đưa `report_count` về 0 và bỏ qua
 * báo cáo mở, nên ba báo cáo cũ không tự ẩn lại ngay.
 */
export async function adminModerateVenueReview(
  input: unknown,
): Promise<Result> {
  const g = await guard(moderateSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { reviewId, action } = g.data;

  let venueId = 0;
  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [r] = await tx
          .select({ id: venueReviews.id, venueId: venueReviews.venueId })
          .from(venueReviews)
          .where(eq(venueReviews.id, reviewId))
          .limit(1);
        if (!r) return { error: t("reviewNotFound") };
        const nowIso = new Date().toISOString();
        const closeReports = (status: "dismissed" | "resolved") =>
          tx
            .update(abuseReports)
            .set({ status, resolvedAt: nowIso })
            .where(
              and(openReviewReports(), eq(abuseReports.targetId, reviewId)),
            );
        const setStatus = async (
          from: VenueReviewStatus[],
          set: Partial<typeof venueReviews.$inferInsert>,
        ) => {
          const changed = await tx
            .update(venueReviews)
            .set({ ...set, updatedAt: nowIso })
            .where(
              and(
                eq(venueReviews.id, reviewId),
                inArray(venueReviews.status, from),
              ),
            )
            .returning({ id: venueReviews.id });
          return changed.length > 0;
        };

        if (action === "approve") {
          if (
            !(await setStatus(["held"], {
              status: "visible",
              holdReason: null,
            }))
          )
            return { error: t("reviewNotFound") };
        } else if (action === "unhide") {
          if (
            !(await setStatus(["hidden"], {
              status: "visible",
              holdReason: null,
              reportCount: 0,
            }))
          )
            return { error: t("reviewNotFound") };
          await closeReports("dismissed");
        } else if (action === "hide") {
          if (!(await setStatus(["visible", "held"], { status: "hidden" })))
            return { error: t("reviewNotFound") };
          await closeReports("resolved");
        } else {
          await closeReports("dismissed");
          await tx
            .update(venueReviews)
            .set({ reportCount: 0 })
            .where(eq(venueReviews.id, reviewId));
        }
        venueId = r.venueId;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Reputation] review_moderate_failed", { id: reviewId });
    return { error: t("saveFailed") };
  }
  // Bỏ qua báo cáo không đổi gì công khai: không làm mới cache. Các hành động
  // còn lại đổi tập đánh giá hiện, nên làm mới tổng của sân và trung bình chung.
  if ("success" in outcome && action !== "dismiss") {
    updateTag(venueReviewTag(venueId));
    updateTag(VENUE_REVIEWS_TAG);
  }
  return outcome;
}

/**
 * Đếm khách quen khép kín từ điểm danh hợp lệ ở các buổi bắt đầu trong
 * `HOST_FLAG_WINDOW_DAYS` ngày. Đọc tối đa `HOST_FLAG_ROW_CAP` dòng, mới trước,
 * để quota Turso có trần; chạm trần thì báo `truncated`.
 */
async function computeCaptiveHosts() {
  const since = new Date(
    Date.now() - HOST_FLAG_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const rows = await hostFlagRowsQuery(db, since);
  return {
    hosts: findCaptiveHosts(
      rows.map((r) => ({
        hostId: r.hostId,
        eventId: r.eventId,
        memberId: r.memberId,
        memberApproved: r.approvalStatus === "approved",
      })),
    ),
    truncated: rows.length >= HOST_FLAG_ROW_CAP,
  };
}

/** Host bị gắn cờ, bỏ host admin đã xem mà số khách quen chưa tăng. */
export async function adminListHostFlags(): Promise<
  Result<{ rows: AdminHostFlagRow[]; truncated: boolean }>
> {
  const denied = await gateAdmin();
  if (denied) return denied;

  const { hosts, truncated } = await computeCaptiveHosts();
  if (hosts.length === 0)
    return { success: true, data: { rows: [], truncated } };
  const ids = hosts.map((h) => h.hostId);
  const [info, reviewed] = await Promise.all([
    db
      .select({ id: members.id, name: members.name, code: members.publicCode })
      .from(members)
      .where(inArray(members.id, ids)),
    db
      .select({
        hostMemberId: hostFlagReviews.hostMemberId,
        captives: hostFlagReviews.captives,
      })
      .from(hostFlagReviews)
      .where(inArray(hostFlagReviews.hostMemberId, ids)),
  ]);
  const infoById = new Map(info.map((m) => [m.id, m]));
  const seenById = new Map(reviewed.map((r) => [r.hostMemberId, r.captives]));
  const rows: AdminHostFlagRow[] = [];
  for (const h of hosts) {
    const m = infoById.get(h.hostId);
    if (!m) continue;
    const seen = seenById.get(h.hostId) ?? null;
    if (seen !== null && h.captives <= seen) continue;
    rows.push({
      hostMemberId: h.hostId,
      hostName: m.name,
      hostCode: m.code,
      captives: h.captives,
      events: h.events,
      reviewedCaptives: seen,
    });
  }
  return { success: true, data: { rows, truncated } };
}

/**
 * Admin bấm "Đã xem": server tự đếm lại số khách quen (không nhận số từ
 * client) và lưu, để cờ chỉ hiện lại khi con số tăng.
 */
export async function adminReviewHostFlag(
  input: unknown,
): Promise<Result<{ captives: number }>> {
  const g = await guard(reviewFlagSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { hostMemberId } = g.data;

  const [host] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, hostMemberId))
    .limit(1);
  if (!host) return { error: t("notFound") };

  const { hosts } = await computeCaptiveHosts();
  const captives = hosts.find((h) => h.hostId === hostMemberId)?.captives ?? 0;
  const reviewedAt = new Date().toISOString();
  try {
    await runSerial(async () => {
      await db
        .insert(hostFlagReviews)
        .values({ hostMemberId, captives, reviewedAt })
        .onConflictDoUpdate({
          target: hostFlagReviews.hostMemberId,
          set: { captives, reviewedAt },
        });
    });
  } catch {
    console.error("[Reputation] host_flag_review_failed", { id: hostMemberId });
    return { error: t("saveFailed") };
  }
  return { success: true, data: { captives } };
}
