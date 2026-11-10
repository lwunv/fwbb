"use server";

import {
  and,
  desc,
  asc,
  eq,
  gte,
  inArray,
  sql,
  isNotNull,
  isNull,
} from "drizzle-orm";
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
  venues,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  type CommentChannel,
  type CommentStatus,
  HOLDING_STATUSES,
  LIST_LIMIT,
  REPORT_STATUSES,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/exchange/constants";
import { commentTag } from "@/lib/exchange/comment-access";
import { groupMemberIdsOf } from "@/lib/exchange/comment-group";
import { cancelEventCore } from "@/lib/exchange/cancel";
import { exchangeGate } from "@/lib/exchange/guards";
import { scheduleRatingReminderAfterCommit } from "@/lib/reputation/rating-jobs";
import { runSerial } from "@/lib/exchange/serial";
import { notifyCommentVisible } from "@/lib/notifications/exchange-comments";
import { notifyEventHidden } from "@/lib/notifications/exchange-events";
import { isNotificationsEnabled } from "@/lib/notifications/notify";

// Mọi export là endpoint POST nên mỗi hàm tự kiểm: cờ, rồi admin từ cookie
// phiên (không bao giờ nhận từ input), rồi zod. Danh sách chỉ có tên, mã buổi,
// tên sân và số đếm; không có sđt/email của ai.

type Result<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { error: string };

export type AdminExchangeFilter = "upcoming" | "hidden" | "all";

export type AdminExchangeRow = {
  id: number;
  publicCode: string;
  title: string;
  status: string;
  startAt: string;
  hiddenAt: string | null;
  hostName: string;
  venueName: string;
  slotsTotal: number;
  holdingHeads: number;
};

export type AdminReportRow = {
  id: number;
  targetType: ReportTargetType;
  /** Tên buổi (target event, comment) hoặc tên member (target member). */
  targetName: string;
  /** Mã buổi để dẫn link /exchanges/{code}; `null` khi đối tượng là member. */
  eventCode: string | null;
  /** 120 ký tự đầu của bình luận bị báo (cả khi đã xoá); null với target khác. */
  commentExcerpt: string | null;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  reporterName: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminCommentRow = {
  id: number;
  eventCode: string;
  eventTitle: string;
  channel: CommentChannel;
  authorName: string;
  authorIsHost: boolean;
  body: string;
  status: CommentStatus;
  openReports: number;
  createdAt: string;
};

const COMMENT_EXCERPT_LEN = 120;
const commentFilterSchema = z.enum(["held", "hidden", "reported"]);
const moderateSchema = z.object({
  commentId: z.number().int().positive(),
  action: z.enum(["approve", "unhide", "delete", "dismiss"]),
});

const filterSchema = z.enum(["upcoming", "hidden", "all"]);
const eventIdSchema = z.object({ eventId: z.number().int().positive() });
const hideSchema = eventIdSchema.extend({ hidden: z.boolean() });
const statusSchema = z.enum(REPORT_STATUSES);
const resolveSchema = z.object({
  reportId: z.number().int().positive(),
  status: z.enum(["resolved", "dismissed"]),
});

/** Cờ, rồi admin, rồi zod; trả dữ liệu đã parse hoặc `{ error }` đã dịch. */
async function guard<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Promise<{ data: z.infer<S> } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const t = await getTranslations("exchange.errors");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  return { data: parsed.data };
}

export async function adminListExchanges(
  filter: unknown,
): Promise<Result<AdminExchangeRow[]>> {
  const g = await guard(filterSchema, filter);
  if ("error" in g) return g;

  const nowIso = new Date().toISOString();
  const where =
    g.data === "hidden"
      ? isNotNull(exchangeEvents.hiddenAt)
      : g.data === "upcoming"
        ? and(
            isNull(exchangeEvents.hiddenAt),
            inArray(exchangeEvents.status, ["open", "full", "locked"]),
            gte(exchangeEvents.startAt, nowIso),
          )
        : undefined;

  const rows = await db
    .select({
      id: exchangeEvents.id,
      publicCode: exchangeEvents.publicCode,
      title: exchangeEvents.title,
      status: exchangeEvents.status,
      startAt: exchangeEvents.startAt,
      hiddenAt: exchangeEvents.hiddenAt,
      hostName: members.name,
      venueName: venues.name,
      slotsTotal: exchangeEvents.slotsTotal,
    })
    .from(exchangeEvents)
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
    .where(where)
    .orderBy(
      g.data === "upcoming"
        ? asc(exchangeEvents.startAt)
        : desc(exchangeEvents.startAt),
    )
    .limit(LIST_LIMIT);

  const heads = new Map<number, number>();
  if (rows.length > 0) {
    const regs = await db
      .select({
        eventId: exchangeRegistrations.eventId,
        maleCount: exchangeRegistrations.maleCount,
        femaleCount: exchangeRegistrations.femaleCount,
      })
      .from(exchangeRegistrations)
      .where(
        and(
          inArray(
            exchangeRegistrations.eventId,
            rows.map((r) => r.id),
          ),
          inArray(exchangeRegistrations.status, [...HOLDING_STATUSES]),
        ),
      );
    for (const r of regs)
      heads.set(
        r.eventId,
        (heads.get(r.eventId) ?? 0) + r.maleCount + r.femaleCount,
      );
  }

  return {
    success: true,
    data: rows.map((r) => ({ ...r, holdingHeads: heads.get(r.id) ?? 0 })),
  };
}

/** Ẩn báo host (chỉ lần chuyển từ hiện sang ẩn); hiện lại thì xoá `hiddenAt`. */
export async function adminSetExchangeHidden(input: unknown): Promise<Result> {
  const g = await guard(hideSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { eventId, hidden } = g.data;

  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [ev] = await tx
          .select()
          .from(exchangeEvents)
          .where(eq(exchangeEvents.id, eventId))
          .limit(1);
        if (!ev) return { error: t("notFound") };

        const now = new Date();
        const nowIso = now.toISOString();
        if (!hidden) {
          await tx
            .update(exchangeEvents)
            .set({ hiddenAt: null, updatedAt: nowIso })
            .where(eq(exchangeEvents.id, eventId));
          return { success: true };
        }
        // Điều kiện hiddenAt IS NULL chặn gửi tin lần hai khi bấm lặp.
        const changed = await tx
          .update(exchangeEvents)
          .set({ hiddenAt: nowIso, updatedAt: nowIso })
          .where(
            and(
              eq(exchangeEvents.id, eventId),
              isNull(exchangeEvents.hiddenAt),
            ),
          )
          .returning({ id: exchangeEvents.id });
        if (changed.length > 0) {
          const notifyOn = await isNotificationsEnabled(tx);
          await notifyEventHidden(tx, { event: ev, now }, notifyOn);
        }
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] admin", { action: "hide", eventId });
    return { error: t("saveFailed") };
  }
  if ("success" in outcome) {
    updateTag("exchange");
    // Ẩn huỷ job nhắc chấm, bỏ ẩn trước giờ nhắc thì hồi sinh (G2d).
    scheduleRatingReminderAfterCommit(eventId);
  }
  return outcome;
}

/** Admin huỷ buổi: dùng chung lõi với host, tin cho người đã đăng ký. */
export async function adminCancelExchange(input: unknown): Promise<Result> {
  const g = await guard(eventIdSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { eventId } = g.data;

  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [ev] = await tx
          .select()
          .from(exchangeEvents)
          .where(eq(exchangeEvents.id, eventId))
          .limit(1);
        if (!ev) return { error: t("notFound") };
        const notifyOn = await isNotificationsEnabled(tx);
        if (!(await cancelEventCore(tx, ev, new Date(), notifyOn)))
          return { error: t("eventClosed") };
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] admin", { action: "cancel", eventId });
    return { error: t("saveFailed") };
  }
  if ("success" in outcome) {
    updateTag("exchange");
    // Huỷ job nhắc chấm của buổi (G2d).
    scheduleRatingReminderAfterCommit(eventId);
  }
  return outcome;
}

export async function adminListReports(
  status: unknown,
): Promise<Result<AdminReportRow[]>> {
  const g = await guard(statusSchema, status);
  if ("error" in g) return g;

  const reports = await db
    .select({
      id: abuseReports.id,
      targetType: abuseReports.targetType,
      targetId: abuseReports.targetId,
      reason: abuseReports.reason,
      note: abuseReports.note,
      status: abuseReports.status,
      reporterName: members.name,
      createdAt: abuseReports.createdAt,
      resolvedAt: abuseReports.resolvedAt,
    })
    .from(abuseReports)
    .innerJoin(members, eq(members.id, abuseReports.reporterMemberId))
    .where(eq(abuseReports.status, g.data))
    .orderBy(desc(abuseReports.createdAt))
    .limit(LIST_LIMIT);

  const eventIds = reports
    .filter((r) => r.targetType === "event")
    .map((r) => r.targetId);
  const memberIds = reports
    .filter((r) => r.targetType === "member")
    .map((r) => r.targetId);
  const commentIds = reports
    .filter((r) => r.targetType === "comment")
    .map((r) => r.targetId);
  const [evs, mems, comments] = await Promise.all([
    eventIds.length
      ? db
          .select({
            id: exchangeEvents.id,
            code: exchangeEvents.publicCode,
            title: exchangeEvents.title,
          })
          .from(exchangeEvents)
          .where(inArray(exchangeEvents.id, eventIds))
      : [],
    memberIds.length
      ? db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, memberIds))
      : [],
    // Một truy vấn cho mọi bình luận bị báo: buổi chứa nó và đoạn đầu nội dung.
    commentIds.length
      ? db
          .select({
            id: exchangeComments.id,
            body: exchangeComments.body,
            code: exchangeEvents.publicCode,
            title: exchangeEvents.title,
          })
          .from(exchangeComments)
          .innerJoin(
            exchangeEvents,
            eq(exchangeEvents.id, exchangeComments.eventId),
          )
          .where(inArray(exchangeComments.id, commentIds))
      : [],
  ]);
  const commentById = new Map(comments.map((c) => [c.id, c]));
  const evById = new Map(evs.map((e) => [e.id, e]));
  const memById = new Map(mems.map((m) => [m.id, m.name]));

  return {
    success: true,
    data: reports.map(({ targetId, ...r }) => {
      if (r.targetType === "comment") {
        const c = commentById.get(targetId);
        return {
          ...r,
          targetName: c?.title ?? "",
          eventCode: c?.code ?? null,
          commentExcerpt: c ? c.body.slice(0, COMMENT_EXCERPT_LEN) : null,
        };
      }
      const ev = r.targetType === "event" ? evById.get(targetId) : undefined;
      return {
        ...r,
        targetName:
          r.targetType === "event"
            ? (ev?.title ?? "")
            : (memById.get(targetId) ?? ""),
        eventCode: ev?.code ?? null,
        commentExcerpt: null,
      };
    }),
  };
}

export async function adminResolveReport(input: unknown): Promise<Result> {
  const g = await guard(resolveSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const updated = await db
    .update(abuseReports)
    .set({ status: g.data.status, resolvedAt: new Date().toISOString() })
    .where(eq(abuseReports.id, g.data.reportId))
    .returning({ id: abuseReports.id });
  if (updated.length === 0) return { error: t("notFound") };
  return { success: true };
}

export async function adminListComments(
  filter: unknown,
): Promise<Result<AdminCommentRow[]>> {
  const g = await guard(commentFilterSchema, filter);
  if ("error" in g) return g;

  // Số báo cáo `open` theo bình luận: một truy vấn GROUP BY, không N+1.
  const countQuery = (ids?: number[]) =>
    db
      .select({
        id: abuseReports.targetId,
        n: sql<number>`count(*)`,
      })
      .from(abuseReports)
      .where(
        and(
          eq(abuseReports.targetType, "comment"),
          eq(abuseReports.status, "open"),
          ids ? inArray(abuseReports.targetId, ids) : undefined,
        ),
      )
      .groupBy(abuseReports.targetId);

  const select = () =>
    db
      .select({
        id: exchangeComments.id,
        eventCode: exchangeEvents.publicCode,
        eventTitle: exchangeEvents.title,
        channel: exchangeComments.channel,
        authorName: members.name,
        authorMemberId: exchangeComments.authorMemberId,
        hostMemberId: exchangeEvents.hostMemberId,
        body: exchangeComments.body,
        status: exchangeComments.status,
        createdAt: exchangeComments.createdAt,
      })
      .from(exchangeComments)
      .innerJoin(
        exchangeEvents,
        eq(exchangeEvents.id, exchangeComments.eventId),
      )
      .innerJoin(members, eq(members.id, exchangeComments.authorMemberId));

  let rows: Awaited<ReturnType<typeof select>>;
  let counts: { id: number; n: number }[];
  if (g.data === "reported") {
    counts = (await countQuery())
      .map((c) => ({ id: c.id, n: Number(c.n) }))
      .sort((a, b) => b.n - a.n || b.id - a.id)
      .slice(0, LIST_LIMIT);
    rows = counts.length
      ? await select().where(
          inArray(
            exchangeComments.id,
            counts.map((c) => c.id),
          ),
        )
      : [];
  } else {
    rows = await select()
      .where(eq(exchangeComments.status, g.data))
      .orderBy(desc(exchangeComments.createdAt))
      .limit(LIST_LIMIT);
    counts = rows.length
      ? (await countQuery(rows.map((r) => r.id))).map((c) => ({
          id: c.id,
          n: Number(c.n),
        }))
      : [];
  }
  const nById = new Map(counts.map((c) => [c.id, c.n]));
  const mapped = rows.map(
    ({ authorMemberId, hostMemberId, ...r }): AdminCommentRow => ({
      ...r,
      authorIsHost: authorMemberId === hostMemberId,
      openReports: nById.get(r.id) ?? 0,
    }),
  );
  if (g.data === "reported")
    mapped.sort((a, b) => b.openReports - a.openReports || b.id - a.id);
  return { success: true, data: mapped };
}

/**
 * Admin kiểm duyệt một bình luận. Mỗi hành động đòi đúng trạng thái xuất phát
 * (approve: held, unhide: hidden, delete: chưa xoá) để bấm lặp không gửi tin hai lần.
 */
export async function adminModerateComment(input: unknown): Promise<Result> {
  const g = await guard(moderateSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { commentId, action } = g.data;

  let eventId = 0;
  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [c] = await tx
          .select({
            id: exchangeComments.id,
            eventId: exchangeComments.eventId,
            channel: exchangeComments.channel,
            parentId: exchangeComments.parentId,
            replyToMemberId: exchangeComments.replyToMemberId,
            authorMemberId: exchangeComments.authorMemberId,
            status: exchangeComments.status,
          })
          .from(exchangeComments)
          .where(eq(exchangeComments.id, commentId))
          .limit(1);
        if (!c) return { error: t("commentNotFound") };
        const nowIso = new Date().toISOString();
        const closeReports = (status: "dismissed" | "resolved") =>
          tx
            .update(abuseReports)
            .set({ status, resolvedAt: nowIso })
            .where(
              and(
                eq(abuseReports.targetType, "comment"),
                eq(abuseReports.targetId, commentId),
                eq(abuseReports.status, "open"),
              ),
            );
        const setStatus = async (
          from: CommentStatus[],
          set: { status: CommentStatus; pinned?: boolean },
        ) => {
          const changed = await tx
            .update(exchangeComments)
            .set(set)
            .where(
              and(
                eq(exchangeComments.id, commentId),
                inArray(exchangeComments.status, from),
              ),
            )
            .returning({ id: exchangeComments.id });
          return changed.length > 0;
        };

        if (action === "dismiss") {
          await closeReports("dismissed");
        } else if (action === "unhide") {
          if (!(await setStatus(["hidden"], { status: "visible" })))
            return { error: t("commentNotFound") };
          await closeReports("dismissed");
        } else if (action === "delete") {
          if (
            !(await setStatus(["visible", "held", "hidden"], {
              status: "deleted",
              pinned: false,
            }))
          )
            return { error: t("commentNotFound") };
          await closeReports("resolved");
        } else {
          if (!(await setStatus(["held"], { status: "visible" })))
            return { error: t("commentNotFound") };
          const [ev] = await tx
            .select({
              id: exchangeEvents.id,
              publicCode: exchangeEvents.publicCode,
              title: exchangeEvents.title,
              hostMemberId: exchangeEvents.hostMemberId,
            })
            .from(exchangeEvents)
            .where(eq(exchangeEvents.id, c.eventId))
            .limit(1);
          let parentAuthorId: number | null = null;
          if (c.parentId !== null) {
            const [p] = await tx
              .select({ a: exchangeComments.authorMemberId })
              .from(exchangeComments)
              .where(eq(exchangeComments.id, c.parentId))
              .limit(1);
            parentAuthorId = p?.a ?? null;
          }
          const now = new Date();
          const notifyOn = await isNotificationsEnabled(tx);
          await notifyCommentVisible(
            tx,
            {
              event: ev,
              comment: {
                id: c.id,
                channel: c.channel,
                parentId: c.parentId,
                authorMemberId: c.authorMemberId,
              },
              parentAuthorId,
              replyToMemberId: c.replyToMemberId,
              groupMemberIds:
                notifyOn && c.channel === "group"
                  ? await groupMemberIdsOf(tx, c.eventId)
                  : [],
            },
            notifyOn,
            now,
          );
        }
        eventId = c.eventId;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment_moderate_failed", { id: commentId });
    return { error: t("saveFailed") };
  }
  // Bỏ qua báo cáo không đổi nội dung công khai: không làm mới cache (đỡ render lại trang buổi).
  if ("success" in outcome && action !== "dismiss")
    updateTag(commentTag(eventId));
  return outcome;
}
