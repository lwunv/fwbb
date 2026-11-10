"use server";

import { and, eq, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import {
  abuseReports,
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  members,
  venueReviews,
  venues,
} from "@/db/schema";
import { requireExchangeMember } from "@/lib/member-auth";
import {
  COMMENT_REPORT_HIDE_THRESHOLD,
  REPORT_REASONS,
  RL_REPORT,
  TS_REPORT,
  type ReportTargetType,
} from "@/lib/exchange/constants";
import {
  commentTag,
  loadCommentWithContext,
} from "@/lib/exchange/comment-access";
import { checkBotAndRate, exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import { notifyReported } from "@/lib/notifications/exchange-events";
import { isNotificationsEnabled } from "@/lib/notifications/notify";
import {
  REVIEW_REPORT_HIDE_THRESHOLD,
  venueReviewTag,
} from "@/lib/reputation/constants";
import { establishedMemberSql } from "@/lib/reputation/eligibility";
import { syncReviewReportCount } from "@/lib/reputation/review-reports";

// Chỉ export action tự kiểm quyền: người báo luôn lấy từ cookie phiên, và
// client không bao giờ gửi member id. Server tự dịch target ra
// (member|event|comment|review|venue, id); người chơi chỉ được nêu bằng mã hồ sơ.

type ReportResult = { success: true } | { error: string };

const reportSchema = z.object({
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("event"), code: z.string().min(1).max(64) }),
    z.object({ type: z.literal("host"), code: z.string().min(1).max(64) }),
    z.object({
      type: z.literal("registration"),
      registrationId: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("comment"),
      commentId: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("player"),
      // Mã hồ sơ do `newPublicCode` sinh, luôn đủ 10 ký tự.
      code: z.string().length(10),
    }),
    z.object({
      type: z.literal("venue"),
      venueId: z.number().int().positive(),
    }),
    z.object({
      type: z.literal("review"),
      reviewId: z.number().int().positive(),
    }),
  ]),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
  turnstileToken: z.string().min(1).max(4096),
});

export async function reportAbuse(input: unknown): Promise<ReportResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_REPORT,
    rateKey: `exchange-report:${member.id}`,
    limit: RL_REPORT.limit,
    windowMs: RL_REPORT.windowMs,
  });
  if ("error" in bot) return bot;

  const note = f.note?.trim() || null;

  // Chỉ gán khi UPDATE có dòng trả về: báo đồng thời chỉ ẩn, ghi log, làm mới cache một lần.
  let hiddenEventId: number | null = null;
  let hiddenCommentId = 0;
  let hiddenReview: { reviewId: number; venueId: number } | null = null;

  try {
    const result = await runSerial(() =>
      db.transaction(async (tx): Promise<ReportResult> => {
        const notifyOn = await isNotificationsEnabled(tx);
        let commentCtx: {
          commentId: number;
          eventId: number;
          authorIsHost: boolean;
        } | null = null;
        let reviewCtx: { reviewId: number; venueId: number } | null = null;

        let targetType: ReportTargetType;
        let targetId: number;

        if (f.target.type === "player") {
          // Khoá hay bị từ chối thì hồ sơ không còn công khai: cùng lỗi với mã sai.
          const [m] = await tx
            .select({
              id: members.id,
              isActive: members.isActive,
              approvalStatus: members.approvalStatus,
            })
            .from(members)
            .where(eq(members.publicCode, f.target.code))
            .limit(1);
          if (!m || !m.isActive || m.approvalStatus === "rejected")
            return { error: t("notFound") };
          if (m.id === member.id) return { error: t("cannotReport") };
          targetType = "member";
          targetId = m.id;
        } else if (f.target.type === "venue") {
          // Sân bị báo không tự ẩn (quyết định 31): chỉ ghi để admin xem.
          const [v] = await tx
            .select({ id: venues.id })
            .from(venues)
            .where(
              and(
                eq(venues.id, f.target.venueId),
                eq(venues.status, "approved"),
              ),
            )
            .limit(1);
          if (!v) return { error: t("reviewVenueNotFound") };
          targetType = "venue";
          targetId = v.id;
        } else if (f.target.type === "review") {
          // Chỉ đánh giá khách đang thấy được: `visible` ở sân `approved`.
          const [r] = await tx
            .select({
              id: venueReviews.id,
              venueId: venueReviews.venueId,
              memberId: venueReviews.memberId,
            })
            .from(venueReviews)
            .innerJoin(venues, eq(venues.id, venueReviews.venueId))
            .where(
              and(
                eq(venueReviews.id, f.target.reviewId),
                eq(venueReviews.status, "visible"),
                eq(venues.status, "approved"),
              ),
            )
            .limit(1);
          if (!r) return { error: t("reviewNotFound") };
          if (r.memberId === member.id) return { error: t("cannotReport") };
          targetType = "review";
          targetId = r.id;
          reviewCtx = { reviewId: r.id, venueId: r.venueId };
        } else if (f.target.type === "comment") {
          // Cùng quyền đọc với người xem: bình luận không thấy được thì coi như không có.
          const found = await loadCommentWithContext(
            tx,
            f.target.commentId,
            member,
            new Date(),
          );
          if (!found || found.comment.status !== "visible")
            return { error: t("commentNotFound") };
          if (found.comment.authorMemberId === member.id)
            return { error: t("cannotReport") };
          targetType = "comment";
          targetId = found.comment.id;
          commentCtx = {
            commentId: found.comment.id,
            eventId: found.ctx.event.id,
            authorIsHost:
              found.comment.authorMemberId === found.ctx.event.hostMemberId,
          };
        } else if (f.target.type === "registration") {
          // Chỉ host của buổi mới báo được người đăng ký; mọi trường hợp khác
          // cùng một lỗi chung để không lộ registration của buổi người khác.
          const [row] = await tx
            .select({
              memberId: exchangeRegistrations.memberId,
              hostMemberId: exchangeEvents.hostMemberId,
            })
            .from(exchangeRegistrations)
            .innerJoin(
              exchangeEvents,
              eq(exchangeEvents.id, exchangeRegistrations.eventId),
            )
            .where(eq(exchangeRegistrations.id, f.target.registrationId))
            .limit(1);
          if (
            !row ||
            row.hostMemberId !== member.id ||
            row.memberId === member.id
          )
            return { error: t("cannotReport") };
          targetType = "member";
          targetId = row.memberId;
        } else {
          const [ev] = await tx
            .select()
            .from(exchangeEvents)
            .where(eq(exchangeEvents.publicCode, f.target.code))
            .limit(1);
          if (!ev) return { error: t("notFound") };

          const isHost = ev.hostMemberId === member.id;
          if (ev.hiddenAt !== null && !isHost) {
            // Buổi bị ẩn: người đã đăng ký vẫn được báo, người lạ coi như không có.
            const [reg] = await tx
              .select({ id: exchangeRegistrations.id })
              .from(exchangeRegistrations)
              .where(
                and(
                  eq(exchangeRegistrations.eventId, ev.id),
                  eq(exchangeRegistrations.memberId, member.id),
                ),
              )
              .limit(1);
            if (!reg) return { error: t("notFound") };
          }
          if (isHost) return { error: t("cannotReport") };

          if (f.target.type === "event") {
            targetType = "event";
            targetId = ev.id;
          } else {
            targetType = "member";
            targetId = ev.hostMemberId;
          }
        }

        const [row] = await tx
          .insert(abuseReports)
          .values({
            reporterMemberId: member.id,
            targetType,
            targetId,
            reason: f.reason,
            note,
            createdAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning({ id: abuseReports.id });

        // Báo trùng: không ghi, không gửi tin thứ hai, và không cho người báo biết.
        if (row)
          await notifyReported(
            tx,
            { reportId: row.id, targetType, reason: f.reason },
            notifyOn,
          );

        // Chỉ tính người báo không phải nick mới; báo trùng (row rỗng) không tính lại.
        if (row && commentCtx && !commentCtx.authorIsHost) {
          const [{ n }] = await tx
            .select({ n: sql<number>`count(*)` })
            .from(abuseReports)
            .innerJoin(members, eq(members.id, abuseReports.reporterMemberId))
            .where(
              and(
                eq(abuseReports.targetType, "comment"),
                eq(abuseReports.targetId, commentCtx.commentId),
                eq(abuseReports.status, "open"),
                establishedMemberSql(members.id, members.approvalStatus),
              ),
            );
          if (Number(n) >= COMMENT_REPORT_HIDE_THRESHOLD) {
            const hidden = await tx
              .update(exchangeComments)
              .set({ status: "hidden", pinned: false })
              .where(
                and(
                  eq(exchangeComments.id, commentCtx.commentId),
                  eq(exchangeComments.status, "visible"),
                ),
              )
              .returning({ id: exchangeComments.id });
            if (hidden.length > 0) {
              hiddenEventId = commentCtx.eventId;
              hiddenCommentId = commentCtx.commentId;
            }
          }
        }

        // Đánh giá sân: đếm lại từ nguồn rồi mới xét ngưỡng; `WHERE status =
        // 'visible'` để báo đồng thời chỉ ẩn một lần.
        if (row && reviewCtx) {
          const n = await syncReviewReportCount(tx, reviewCtx.reviewId);
          if (n >= REVIEW_REPORT_HIDE_THRESHOLD) {
            const hidden = await tx
              .update(venueReviews)
              .set({ status: "hidden" })
              .where(
                and(
                  eq(venueReviews.id, reviewCtx.reviewId),
                  eq(venueReviews.status, "visible"),
                ),
              )
              .returning({ id: venueReviews.id });
            if (hidden.length > 0) hiddenReview = reviewCtx;
          }
        }
        return { success: true };
      }),
    );
    if (hiddenEventId !== null) {
      console.error("[Exchange] comment_hidden", {
        commentId: hiddenCommentId,
      });
      updateTag(commentTag(hiddenEventId));
    }
    const review = hiddenReview as { reviewId: number; venueId: number } | null;
    if (review) {
      console.error("[Reputation] review_hidden", {
        reviewId: review.reviewId,
      });
      updateTag(venueReviewTag(review.venueId));
    }
    return result;
  } catch {
    console.error("[Exchange] report_failed", { targetType: f.target.type });
    return { error: t("saveFailed") };
  }
}
