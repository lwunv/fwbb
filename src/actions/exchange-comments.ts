"use server";

import { and, count, eq, ne, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import {
  exchangeCommentVotes,
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
} from "@/db/schema";
import type { Tx } from "@/db/tx";
import { attendanceStats } from "@/lib/exchange/attendance";
import {
  COMMENT_CHANNELS,
  COMMENT_CHANNEL_CAP,
  COMMENT_EDIT_WINDOW_MS,
  COMMENT_MAX_LEN,
  COMMENT_MAX_ROWS,
  COMMENT_PAGE_ROOTS,
  COMMENT_REPLIES_PAGE,
  COMMENT_SORTS,
  RL_COMMENT_BURST,
  RL_COMMENT_DAY,
  RL_COMMENT_DAY_NEW,
  RL_COMMENT_EDIT,
  RL_COMMENT_HOST,
  RL_COMMENT_MOD,
  RL_COMMENT_VOTE,
  TS_COMMENT,
} from "@/lib/exchange/constants";
import {
  commentMetaTag,
  commentTag,
  getCommentEventMetaCached,
  loadCommentContext,
  loadCommentInEvent,
  loadCommentWithContext,
  type CommentContext,
  type CommentRole,
  type CommentWriteState,
} from "@/lib/exchange/comment-access";
import { grantCommentPass, hasCommentPass } from "@/lib/exchange/comment-pass";
import {
  applyViewerOverlay,
  getPublicQaPageCached,
  hasUnreadComments,
  isCommentReader,
  loadReplyRows,
  loadThreadRows,
  loadViewerOverlay,
  markCommentsReadUpTo,
} from "@/lib/exchange/comment-reads";
import {
  buildThreads,
  type BuildThreadsOpts,
  type CommentRow,
  type CommentView,
} from "@/lib/exchange/comment-tree";
import {
  detectContact,
  normalizeCommentBody,
} from "@/lib/exchange/comment-text";
import {
  checkBotAndRate,
  exchangeGate,
  loadHostedEvent,
} from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import {
  notifyCommentHeld,
  notifyCommentVisible,
} from "@/lib/notifications/exchange-comments";
import { isNotificationsEnabled } from "@/lib/notifications/notify";
import { getExchangeViewer, requireExchangeMember } from "@/lib/member-auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Chỉ export action tự kiểm quyền: người thực hiện luôn lấy từ cookie phiên.
// Mọi helper nhận db/tx/memberId/eventId nằm ở src/lib/exchange/comment-*.ts.

type Translate = Awaited<ReturnType<typeof getTranslations>>;
type AddResult =
  | { success: true; data: { id: number; status: "visible" | "held" } }
  | { needsCaptcha: true }
  | { error: string };
type SimpleResult = { success: true } | { error: string };

const inflightAdds = new Map<string, Promise<AddResult>>();

const bodySchema = z
  .string()
  .max(COMMENT_MAX_LEN * 4)
  .transform(normalizeCommentBody)
  .pipe(z.string().min(1).max(COMMENT_MAX_LEN));

const addSchema = z.object({
  code: z.string().min(1).max(64),
  channel: z.enum(COMMENT_CHANNELS),
  parentId: z.number().int().positive().optional(),
  body: bodySchema,
  idempotencyKey: z.string().uuid(),
  turnstileToken: z.string().min(1).max(4096).optional(),
});
const editSchema = z.object({
  commentId: z.number().int().positive(),
  body: bodySchema,
});
const deleteSchema = z.object({ commentId: z.number().int().positive() });

function isUniqueViolation(e: unknown): boolean {
  const text = [e, (e as { cause?: unknown } | null)?.cause]
    .map((x) => (x instanceof Error ? x.message : String(x ?? "")))
    .join(" ");
  return /UNIQUE constraint failed/i.test(text);
}

/** Một thông báo chung cho người bị chặn và người thiếu quyền khu: không lộ ai chặn ai. */
function writeBlock(
  ctx: CommentContext,
  channel: (typeof COMMENT_CHANNELS)[number],
  t: Translate,
): string | null {
  if (ctx.blocked || !ctx.canRead[channel]) return t("cannotComment");
  if (ctx.writeState === "locked") return t("commentsLocked");
  if (ctx.writeState === "closed") return t("commentsClosed");
  return ctx.canWrite[channel] ? null : t("cannotComment");
}

async function groupMemberIdsOf(tx: Tx, eventId: number): Promise<number[]> {
  const rows = await tx
    .select({ id: exchangeRegistrations.memberId })
    .from(exchangeRegistrations)
    .where(
      and(
        eq(exchangeRegistrations.eventId, eventId),
        eq(exchangeRegistrations.status, "approved"),
      ),
    );
  return rows.map((r) => r.id);
}

export async function addComment(input: unknown): Promise<AddResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  // Gửi lại cùng khoá: trả dòng cũ, không tốn rate limit, không báo lần hai.
  const replay = async (): Promise<AddResult | null> => {
    const [row] = await db
      .select({ id: exchangeComments.id, status: exchangeComments.status })
      .from(exchangeComments)
      .where(
        and(
          eq(exchangeComments.idempotencyKey, f.idempotencyKey),
          eq(exchangeComments.authorMemberId, member.id),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.status !== "visible" && row.status !== "held")
      return { error: t("commentNotFound") };
    return { success: true, data: { id: row.id, status: row.status } };
  };
  const prior = await replay();
  if (prior) return prior;

  // Hai lần gửi cùng khoá chạy đua trong một instance: lần sau đợi lần trước
  // xong rồi trả dòng của nó, thay vì dính rate limit chung khoá burst.
  const flightKey = `${member.id}:${f.idempotencyKey}`;
  const inFlight = inflightAdds.get(flightKey);
  if (inFlight) {
    await inFlight.catch(() => undefined);
    const again = await replay();
    if (again) return again;
  }
  const work = addCommentChecked();
  inflightAdds.set(flightKey, work);
  try {
    return await work;
  } finally {
    if (inflightAdds.get(flightKey) === work) inflightAdds.delete(flightKey);
  }

  async function addCommentChecked(): Promise<AddResult> {
    const meta = await getCommentEventMetaCached(f.code);
    if (!meta) return { error: t("commentNotFound") };
    const isHostHere = meta.hostMemberId === member.id;

    const rate = isHostHere
      ? {
          key: `exchange-comment-host:${member.id}`,
          limit: RL_COMMENT_HOST.limit,
          windowMs: RL_COMMENT_HOST.windowMs,
        }
      : {
          key: `exchange-comment-burst:${member.id}`,
          limit: RL_COMMENT_BURST.limit,
          windowMs: RL_COMMENT_BURST.windowMs,
        };

    if (await hasCommentPass(member.id)) {
      const rl = await checkRateLimit(rate.key, rate.limit, rate.windowMs);
      if (!rl.ok)
        return (
          (await replay()) ?? {
            error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }),
          }
        );
    } else {
      if (!f.turnstileToken) return { needsCaptcha: true };
      const bot = await checkBotAndRate({
        token: f.turnstileToken,
        action: TS_COMMENT,
        rateKey: rate.key,
        limit: rate.limit,
        windowMs: rate.windowMs,
      });
      if ("error" in bot) return (await replay()) ?? bot;
      const pass = await grantCommentPass(member.id);
      if (!pass.ok) return { error: t("config") };
    }

    if (!isHostHere) {
      const isNew =
        member.approvalStatus !== "approved" &&
        (await attendanceStats(db, member.id)).checkedIn === 0;
      const day = isNew ? RL_COMMENT_DAY_NEW : RL_COMMENT_DAY;
      const rl = await checkRateLimit(
        `exchange-comment-day:${member.id}`,
        day.limit,
        day.windowMs,
      );
      if (!rl.ok)
        return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };
    }

    let eventId = 0;
    let result: AddResult;
    try {
      result = await runSerial(() =>
        db.transaction(async (tx): Promise<AddResult> => {
          const now = new Date();
          const ctx = await loadCommentContext(
            tx,
            { code: f.code },
            member,
            now,
            { fresh: true },
          );
          if (!ctx) return { error: t("commentNotFound") };
          const blockMsg = writeBlock(ctx, f.channel, t);
          if (blockMsg) return { error: blockMsg };
          const isHost = ctx.role === "host";

          const [{ n }] = await tx
            .select({ n: count() })
            .from(exchangeComments)
            .where(
              and(
                eq(exchangeComments.eventId, ctx.event.id),
                eq(exchangeComments.channel, f.channel),
              ),
            );
          if (n >= COMMENT_CHANNEL_CAP)
            return { error: t("commentCapReached") };

          let storedParentId: number | null = null;
          let parentAuthorId: number | null = null;
          let replyToMemberId: number | null = null;
          if (f.parentId !== undefined) {
            const parent = await loadCommentInEvent(
              tx,
              f.parentId,
              ctx,
              member.id,
            );
            if (
              !parent ||
              parent.channel !== f.channel ||
              !(
                parent.status === "visible" ||
                (parent.status === "held" && isHost)
              )
            )
              return { error: t("commentNotFound") };
            replyToMemberId = parent.authorMemberId;
            storedParentId = parent.id;
            parentAuthorId = parent.authorMemberId;
            if (parent.parentId !== null) {
              const [up] = await tx
                .select({
                  parentId: exchangeComments.parentId,
                  authorMemberId: exchangeComments.authorMemberId,
                })
                .from(exchangeComments)
                .where(eq(exchangeComments.id, parent.parentId))
                .limit(1);
              // Cha đã ở tầng 2: trả lời được lưu dưới cha tầng 1 của nó.
              if (up && up.parentId !== null) {
                storedParentId = parent.parentId;
                parentAuthorId = up.authorMemberId;
              }
            }
          }

          const contact = detectContact(f.body);
          const held =
            f.channel === "qa" && !isHost && (contact.phone || contact.link);
          const status = held ? "held" : "visible";

          const [row] = await tx
            .insert(exchangeComments)
            .values({
              eventId: ctx.event.id,
              channel: f.channel,
              parentId: storedParentId,
              replyToMemberId,
              authorMemberId: member.id,
              body: f.body,
              status,
              idempotencyKey: f.idempotencyKey,
              createdAt: now.toISOString(),
            })
            .returning({ id: exchangeComments.id });

          const notifyOn = await isNotificationsEnabled(tx);
          const evRef = {
            id: ctx.event.id,
            publicCode: ctx.event.publicCode,
            title: ctx.event.title,
            hostMemberId: ctx.event.hostMemberId,
          };
          if (held) {
            await notifyCommentHeld(
              tx,
              { event: evRef, commentId: row.id },
              notifyOn,
              now,
            );
          } else {
            await notifyCommentVisible(
              tx,
              {
                event: evRef,
                comment: {
                  id: row.id,
                  channel: f.channel,
                  parentId: storedParentId,
                  authorMemberId: member.id,
                },
                parentAuthorId,
                replyToMemberId,
                groupMemberIds:
                  notifyOn && f.channel === "group"
                    ? await groupMemberIdsOf(tx, ctx.event.id)
                    : [],
              },
              notifyOn,
              now,
            );
          }
          eventId = ctx.event.id;
          return { success: true, data: { id: row.id, status } };
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Hai lần gửi cùng khoá chạy đua: dòng thắng cuộc là kết quả.
        const again = await replay();
        if (again) return again;
      }
      console.error("[Exchange] comment-add-failed", { id: member.id });
      return { error: t("commentSaveFailed") };
    }

    if ("success" in result) updateTag(commentTag(eventId));
    return result;
  }
}

export async function editComment(input: unknown): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const rl = await checkRateLimit(
    `exchange-comment-edit:${member.id}`,
    RL_COMMENT_EDIT.limit,
    RL_COMMENT_EDIT.windowMs,
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  let eventId = 0;
  let result: SimpleResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SimpleResult> => {
        const now = new Date();
        const found = await loadCommentWithContext(
          tx,
          f.commentId,
          member,
          now,
        );
        if (!found) return { error: t("commentNotFound") };
        const { ctx, comment } = found;
        if (comment.authorMemberId !== member.id)
          return { error: t("cannotComment") };
        if (comment.status !== "visible" && comment.status !== "held")
          return { error: t("commentNotFound") };
        const blockMsg = writeBlock(ctx, comment.channel, t);
        if (blockMsg) return { error: blockMsg };
        if (
          now.getTime() - Date.parse(comment.createdAt) >
          COMMENT_EDIT_WINDOW_MS
        )
          return { error: t("commentEditExpired") };

        const [full] = await tx
          .select({ replyToMemberId: exchangeComments.replyToMemberId })
          .from(exchangeComments)
          .where(eq(exchangeComments.id, comment.id))
          .limit(1);

        const contact = detectContact(f.body);
        const shouldHold =
          comment.channel === "qa" &&
          ctx.role !== "host" &&
          (contact.phone || contact.link);
        const status = shouldHold ? "held" : "visible";
        const becameHeld = shouldHold && comment.status === "visible";
        const becameVisible = !shouldHold && comment.status === "held";

        await tx
          .update(exchangeComments)
          .set({
            body: f.body,
            status,
            ...(becameHeld ? { pinned: false } : {}),
            editedAt: now.toISOString(),
          })
          .where(eq(exchangeComments.id, comment.id));

        if (becameHeld || becameVisible) {
          const notifyOn = await isNotificationsEnabled(tx);
          const evRef = {
            id: ctx.event.id,
            publicCode: ctx.event.publicCode,
            title: ctx.event.title,
            hostMemberId: ctx.event.hostMemberId,
          };
          if (becameHeld) {
            await notifyCommentHeld(
              tx,
              { event: evRef, commentId: comment.id },
              notifyOn,
              now,
            );
          } else {
            let parentAuthorId: number | null = null;
            if (comment.parentId !== null) {
              const [p] = await tx
                .select({ a: exchangeComments.authorMemberId })
                .from(exchangeComments)
                .where(eq(exchangeComments.id, comment.parentId))
                .limit(1);
              parentAuthorId = p?.a ?? null;
            }
            await notifyCommentVisible(
              tx,
              {
                event: evRef,
                comment: {
                  id: comment.id,
                  channel: comment.channel,
                  parentId: comment.parentId,
                  authorMemberId: comment.authorMemberId,
                },
                parentAuthorId,
                replyToMemberId: full?.replyToMemberId ?? null,
                groupMemberIds:
                  notifyOn && comment.channel === "group"
                    ? await groupMemberIdsOf(tx, ctx.event.id)
                    : [],
              },
              notifyOn,
              now,
            );
          }
        }
        eventId = ctx.event.id;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment-edit-failed", { id: f.commentId });
    return { error: t("commentSaveFailed") };
  }

  if ("success" in result) updateTag(commentTag(eventId));
  return result;
}

export async function deleteComment(input: unknown): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const rl = await checkRateLimit(
    `exchange-comment-mod:${member.id}`,
    RL_COMMENT_MOD.limit,
    RL_COMMENT_MOD.windowMs,
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  let eventId = 0;
  let result: SimpleResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SimpleResult> => {
        const found = await loadCommentWithContext(
          tx,
          f.commentId,
          member,
          new Date(),
          { authorAnyChannel: true },
        );
        if (!found) return { error: t("commentNotFound") };
        const { ctx, comment } = found;
        if (comment.authorMemberId !== member.id && ctx.role !== "host")
          return { error: t("cannotComment") };
        if (comment.status !== "visible" && comment.status !== "held")
          return { error: t("commentNotFound") };
        // Xoá được cả khi khoá hoặc đóng bình luận; trả lời bên dưới giữ nguyên.
        await tx
          .update(exchangeComments)
          .set({ status: "deleted", pinned: false })
          .where(eq(exchangeComments.id, comment.id));
        eventId = ctx.event.id;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment-delete-failed", { id: f.commentId });
    return { error: t("commentSaveFailed") };
  }

  if ("success" in result) updateTag(commentTag(eventId));
  return result;
}

const voteSchema = z.object({
  commentId: z.number().int().positive(),
  voted: z.boolean(),
});
const pinSchema = z.object({
  commentId: z.number().int().positive(),
  pinned: z.boolean(),
});
const lockSchema = z.object({
  eventId: z.number().int().positive(),
  locked: z.boolean(),
});
const approveSchema = z.object({ commentId: z.number().int().positive() });

type VoteResult =
  | { success: true; data: { upvotes: number } }
  | { error: string };

/**
 * Bấm Hữu ích. Cố ý không gọi `updateTag` và không đặt cookie: cả hai làm Next
 * render lại cả trang buổi, quá đắt cho một lượt bấm. Số mới trả về cho client
 * tự cập nhật, cache công khai hội tụ khi có thao tác khác hoặc hết hạn.
 */
export async function toggleCommentVote(input: unknown): Promise<VoteResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = voteSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  // Hữu ích là đường nóng, nhiều người bấm cùng lúc: xếp cả bước rate limit vào
  // hàng đợi ghi để không tranh khoá SQLite với transaction của lượt khác.
  const rl = await runSerial(() =>
    checkRateLimit(
      `exchange-comment-vote:${member.id}`,
      RL_COMMENT_VOTE.limit,
      RL_COMMENT_VOTE.windowMs,
    ),
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  try {
    return await runSerial(() =>
      db.transaction(async (tx): Promise<VoteResult> => {
        const now = new Date();
        const found = await loadCommentWithContext(
          tx,
          f.commentId,
          member,
          now,
        );
        if (!found) return { error: t("commentNotFound") };
        const { ctx, comment } = found;
        if (comment.status !== "visible")
          return { error: t("commentNotFound") };
        if (comment.authorMemberId === member.id)
          return { error: t("cannotComment") };
        if (ctx.blocked || !ctx.canRead[comment.channel])
          return { error: t("cannotComment") };
        if (ctx.writeState === "closed") return { error: t("commentsClosed") };

        if (f.voted) {
          const inserted = await tx
            .insert(exchangeCommentVotes)
            .values({
              commentId: comment.id,
              memberId: member.id,
              createdAt: now.toISOString(),
            })
            .onConflictDoNothing()
            .returning({ id: exchangeCommentVotes.id });
          if (inserted.length > 0)
            await tx
              .update(exchangeComments)
              .set({ upvotes: sql`${exchangeComments.upvotes} + 1` })
              .where(eq(exchangeComments.id, comment.id));
        } else {
          const removed = await tx
            .delete(exchangeCommentVotes)
            .where(
              and(
                eq(exchangeCommentVotes.commentId, comment.id),
                eq(exchangeCommentVotes.memberId, member.id),
              ),
            )
            .returning({ id: exchangeCommentVotes.id });
          if (removed.length > 0)
            await tx
              .update(exchangeComments)
              .set({ upvotes: sql`MAX(${exchangeComments.upvotes} - 1, 0)` })
              .where(eq(exchangeComments.id, comment.id));
        }
        const [{ upvotes }] = await tx
          .select({ upvotes: exchangeComments.upvotes })
          .from(exchangeComments)
          .where(eq(exchangeComments.id, comment.id));
        return { success: true, data: { upvotes } };
      }),
    );
  } catch {
    console.error("[Exchange] comment-vote-failed", { id: f.commentId });
    return { error: t("commentSaveFailed") };
  }
}

export async function pinComment(input: unknown): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const rl = await checkRateLimit(
    `exchange-comment-mod:${member.id}`,
    RL_COMMENT_MOD.limit,
    RL_COMMENT_MOD.windowMs,
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  let eventId = 0;
  let result: SimpleResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SimpleResult> => {
        const found = await loadCommentWithContext(
          tx,
          f.commentId,
          member,
          new Date(),
        );
        if (!found || found.ctx.role !== "host")
          return { error: t("commentNotFound") };
        const { ctx, comment } = found;
        if (comment.parentId !== null || comment.status !== "visible")
          return { error: t("commentNotFound") };
        if (f.pinned) {
          // Mỗi khu chỉ một bình luận ghim.
          await tx
            .update(exchangeComments)
            .set({ pinned: false })
            .where(
              and(
                eq(exchangeComments.eventId, comment.eventId),
                eq(exchangeComments.channel, comment.channel),
                ne(exchangeComments.id, comment.id),
              ),
            );
        }
        await tx
          .update(exchangeComments)
          .set({ pinned: f.pinned })
          .where(eq(exchangeComments.id, comment.id));
        eventId = ctx.event.id;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment-pin-failed", { id: f.commentId });
    return { error: t("commentSaveFailed") };
  }

  if ("success" in result) updateTag(commentTag(eventId));
  return result;
}

export async function setCommentsLocked(input: unknown): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = lockSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const rl = await checkRateLimit(
    `exchange-comment-mod:${member.id}`,
    RL_COMMENT_MOD.limit,
    RL_COMMENT_MOD.windowMs,
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  let code = "";
  let result: SimpleResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SimpleResult> => {
        const ev = await loadHostedEvent(tx, f.eventId, member.id);
        if (!ev) return { error: t("commentNotFound") };
        await tx
          .update(exchangeEvents)
          .set({ commentsLocked: f.locked })
          .where(eq(exchangeEvents.id, ev.id));
        code = ev.publicCode;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment-lock-failed", { id: f.eventId });
    return { error: t("commentSaveFailed") };
  }

  if ("success" in result) {
    updateTag(commentTag(f.eventId));
    updateTag(commentMetaTag(code));
  }
  return result;
}

export async function approveHeldComment(
  input: unknown,
): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const rl = await checkRateLimit(
    `exchange-comment-mod:${member.id}`,
    RL_COMMENT_MOD.limit,
    RL_COMMENT_MOD.windowMs,
  );
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };

  let eventId = 0;
  let result: SimpleResult;
  try {
    result = await runSerial(() =>
      db.transaction(async (tx): Promise<SimpleResult> => {
        const now = new Date();
        const found = await loadCommentWithContext(
          tx,
          f.commentId,
          member,
          now,
        );
        if (!found || found.ctx.role !== "host")
          return { error: t("commentNotFound") };
        const { ctx, comment } = found;
        if (comment.status !== "held") return { error: t("commentNotFound") };

        await tx
          .update(exchangeComments)
          .set({ status: "visible" })
          .where(eq(exchangeComments.id, comment.id));

        const [full] = await tx
          .select({ replyToMemberId: exchangeComments.replyToMemberId })
          .from(exchangeComments)
          .where(eq(exchangeComments.id, comment.id))
          .limit(1);
        let parentAuthorId: number | null = null;
        if (comment.parentId !== null) {
          const [p] = await tx
            .select({ a: exchangeComments.authorMemberId })
            .from(exchangeComments)
            .where(eq(exchangeComments.id, comment.parentId))
            .limit(1);
          parentAuthorId = p?.a ?? null;
        }
        const notifyOn = await isNotificationsEnabled(tx);
        await notifyCommentVisible(
          tx,
          {
            event: {
              id: ctx.event.id,
              publicCode: ctx.event.publicCode,
              title: ctx.event.title,
              hostMemberId: ctx.event.hostMemberId,
            },
            comment: {
              id: comment.id,
              channel: comment.channel,
              parentId: comment.parentId,
              authorMemberId: comment.authorMemberId,
            },
            parentAuthorId,
            replyToMemberId: full?.replyToMemberId ?? null,
            groupMemberIds:
              notifyOn && comment.channel === "group"
                ? await groupMemberIdsOf(tx, ctx.event.id)
                : [],
          },
          notifyOn,
          now,
        );
        eventId = ctx.event.id;
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] comment-approve-failed", { id: f.commentId });
    return { error: t("commentSaveFailed") };
  }

  if ("success" in result) updateTag(commentTag(eventId));
  return result;
}

export type CommentPage = {
  channel: (typeof COMMENT_CHANNELS)[number];
  sort: (typeof COMMENT_SORTS)[number];
  roots: CommentView[];
  /** Hàng chờ duyệt của khu, chỉ host ở trang đầu. */
  hostHeld: CommentView[];
  hasMore: boolean;
  nextOffset: number | null;
  /** Số bình luận đang hiện của khu. */
  total: number;
  writeState: CommentWriteState;
  role: CommentRole;
  canRead: CommentContext["canRead"];
  canWrite: boolean;
  needsCaptcha: boolean;
  unread: boolean;
  /** Mốc mới nhất trong trang, để client gọi `markCommentsRead`. */
  newestAt: string | null;
};
type ListResult = { success: true; data: CommentPage } | { error: string };
type RepliesResult =
  | {
      success: true;
      data: {
        replies: CommentView[];
        hasMore: boolean;
        nextOffset: number | null;
      };
    }
  | { error: string };

const listSchema = z.object({
  code: z.string().min(1).max(64),
  channel: z.enum(COMMENT_CHANNELS),
  sort: z.enum(COMMENT_SORTS),
  offset: z
    .number()
    .int()
    .min(0)
    .max(COMMENT_CHANNEL_CAP)
    .refine((n) => n % COMMENT_PAGE_ROOTS === 0),
});
const repliesSchema = z.object({
  commentId: z.number().int().positive(),
  offset: z.number().int().min(0).max(COMMENT_CHANNEL_CAP),
});
const markSchema = z.object({
  code: z.string().min(1).max(64),
  channel: z.enum(COMMENT_CHANNELS),
  upTo: z.string().datetime(),
});

/** Khách, tài khoản bị khoá hay bị từ chối đều đọc như khách. Khách không chạm bảng members. */
async function readerOrGuest(): Promise<{ id: number } | null> {
  const v = await getExchangeViewer();
  return v.status === "ok" ? { id: v.member.id } : null;
}

function treeOpts(
  ctx: CommentContext,
  viewer: { id: number } | null,
  channel: (typeof COMMENT_CHANNELS)[number],
  sort: (typeof COMMENT_SORTS)[number],
  myVotes: Set<number>,
  now: Date,
): BuildThreadsOpts {
  return {
    hostMemberId: ctx.event.hostMemberId,
    viewerId: viewer?.id ?? null,
    isHost: ctx.role === "host",
    myVotes,
    sort,
    now,
    writeOpen: ctx.canWrite[channel],
  };
}

/**
 * Hàng chờ duyệt cũng đi qua `buildThreads` để không lộ member id. Mỗi dòng
 * đứng riêng (không cây), mới nhất trước; `parentId` thật được gắn lại sau.
 */
function heldQueue(rows: CommentRow[], opts: BuildThreadsOpts): CommentView[] {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));
  return buildThreads(
    rows.map((r) => ({ ...r, parentId: null, pinned: false, replyCount: 0 })),
    { ...opts, sort: "new" },
  ).map((v) => ({ ...v, parentId: parentOf.get(v.id) ?? null }));
}

/**
 * Một trang bình luận của một khu. Hỏi đáp đọc qua cache công khai (khách không
 * truy vấn DB khi cache còn); Nhóm buổi đọc thẳng, không bao giờ qua cache.
 * Người đã đăng nhập được ghép phần riêng (phiếu, số Hữu ích mới, bản đầy đủ
 * của bình luận chờ duyệt mình được thấy). Không ghi gì, không đặt cookie.
 */
export async function listExchangeComments(
  input: unknown,
): Promise<ListResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const t = await getTranslations("exchange.errors");
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const now = new Date();
  const viewer = await readerOrGuest();
  const ctx = await loadCommentContext(db, { code: f.code }, viewer, now);
  if (!ctx || !ctx.canRead[f.channel]) return { error: t("commentNotFound") };

  const page =
    f.channel === "qa"
      ? await getPublicQaPageCached(ctx.event.id, f.sort, f.offset)
      : await loadThreadRows(db, ctx.event.id, "group", f.sort, f.offset);

  let rows = page.rows;
  let myVotes = new Set<number>();
  let held: CommentRow[] = [];
  if (viewer) {
    const overlay = await loadViewerOverlay(db, ctx, viewer.id, rows, {
      channel: f.channel,
      offset: f.offset,
    });
    rows = applyViewerOverlay(rows, overlay);
    myVotes = overlay.myVotes;
    held = overlay.hostHeld;
  }
  const opts = treeOpts(ctx, viewer, f.channel, f.sort, myVotes, now);
  const newestAt = rows.reduce<string | null>(
    (m, r) =>
      r.status === "visible" && (m === null || r.createdAt > m)
        ? r.createdAt
        : m,
    null,
  );

  return {
    success: true,
    data: {
      channel: f.channel,
      sort: f.sort,
      roots: buildThreads(rows, opts),
      hostHeld: heldQueue(held, opts),
      hasMore: page.hasMore,
      nextOffset: page.hasMore ? f.offset + COMMENT_PAGE_ROOTS : null,
      total: page.total,
      writeState: ctx.writeState,
      role: ctx.role,
      canRead: ctx.canRead,
      canWrite: ctx.canWrite[f.channel],
      needsCaptcha: viewer ? !(await hasCommentPass(viewer.id)) : false,
      unread: viewer
        ? await hasUnreadComments(db, ctx, viewer.id, f.channel, now)
        : false,
      newestAt,
    },
  };
}

/** "Xem thêm trả lời" của một gốc hoặc một tầng 1, cùng luật thấy như trang. */
export async function listCommentReplies(
  input: unknown,
): Promise<RepliesResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const t = await getTranslations("exchange.errors");
  const parsed = repliesSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const now = new Date();
  const viewer = await readerOrGuest();
  // Null cả khi khu không đọc được hoặc là `held` của người khác.
  const found = await loadCommentWithContext(db, f.commentId, viewer, now);
  if (!found) return { error: t("commentNotFound") };
  const { ctx, comment } = found;

  const page = await loadReplyRows(db, comment.id, f.offset);
  let rows = page.rows;
  let myVotes = new Set<number>();
  if (viewer) {
    const overlay = await loadViewerOverlay(db, ctx, viewer.id, rows);
    rows = applyViewerOverlay(rows, overlay);
    myVotes = overlay.myVotes;
  }
  // Neo giả làm gốc để buildThreads dựng cây con; neo không được trả về.
  const anchor: CommentRow = {
    id: comment.id,
    parentId: null,
    channel: comment.channel,
    authorMemberId: null,
    authorName: null,
    authorAvatarUrl: null,
    authorAvatarKey: null,
    replyToName: null,
    body: "",
    status: "visible",
    upvotes: 0,
    pinned: false,
    editedAt: null,
    createdAt: comment.createdAt,
    replyCount: 0,
  };
  const opts = treeOpts(ctx, viewer, comment.channel, "top", myVotes, now);
  const [tree] = buildThreads([anchor, ...rows], opts);
  const step =
    comment.parentId === null ? COMMENT_REPLIES_PAGE : COMMENT_MAX_ROWS;
  return {
    success: true,
    data: {
      replies: tree?.replies ?? [],
      hasMore: page.hasMore,
      nextOffset: page.hasMore ? f.offset + step : null,
    },
  };
}

/**
 * Lưu mốc đã đọc của một khu = min(upTo, now), chỉ tiến lên. Chỉ host và người
 * có đăng ký đọc được khu đó; người khác nhận `success` mà không ghi gì. Cố ý
 * không gọi `updateTag` và không đặt cookie (cả hai làm Next render lại trang).
 */
export async function markCommentsRead(input: unknown): Promise<SimpleResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const now = new Date();
  const ctx = await loadCommentContext(db, { code: f.code }, member, now);
  if (!ctx) return { error: t("commentNotFound") };
  if (!ctx.canRead[f.channel]) return { success: true };
  if (!(await isCommentReader(db, ctx, member.id))) return { success: true };

  const upTo = new Date(f.upTo).toISOString();
  const nowIso = now.toISOString();
  try {
    await runSerial(() =>
      markCommentsReadUpTo(
        db,
        ctx.event.id,
        member.id,
        f.channel,
        upTo < nowIso ? upTo : nowIso,
      ),
    );
  } catch {
    console.error("[Exchange] comment-read-failed", { id: ctx.event.id });
    return { error: t("commentSaveFailed") };
  }
  return { success: true };
}
