import "server-only";
import { and, eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import type { DbOrTx } from "@/db/tx";
import {
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  members,
} from "@/db/schema";
import { isBlockedByHost } from "./guards";
import {
  COMMENT_OPEN_AFTER_END_DAYS,
  type CommentChannel,
  type CommentStatus,
} from "./constants";

export const commentTag = (eventId: number): string => `xcmt:e${eventId}`;
export const commentMetaTag = (code: string): string => `xcmeta:${code}`;

/** Phần của buổi mà quyền bình luận cần. Thuần JSON: đi qua Data Cache được. */
export type CommentEventMeta = {
  id: number;
  publicCode: string;
  title: string;
  hostMemberId: number;
  /** Host đang hoạt động và đã được duyệt (cùng nghĩa với `activeHostWhere`). */
  hostActive: boolean;
  hidden: boolean;
  status: (typeof exchangeEvents.$inferSelect)["status"];
  endAt: string;
  cancelledAt: string | null;
  commentsLocked: boolean;
};

export type CommentWriteState = "open" | "locked" | "closed";
export type CommentRole = "guest" | "member" | "approved" | "host";

export type CommentContext = {
  event: CommentEventMeta;
  role: CommentRole;
  canRead: Record<CommentChannel, boolean>;
  canWrite: Record<CommentChannel, boolean>;
  writeState: CommentWriteState;
  blocked: boolean;
};

export type CommentRowLite = {
  id: number;
  eventId: number;
  channel: CommentChannel;
  parentId: number | null;
  authorMemberId: number;
  status: CommentStatus;
  pinned: boolean;
  createdAt: string;
};

async function readMeta(
  tx: DbOrTx,
  where: ReturnType<typeof eq>,
): Promise<CommentEventMeta | null> {
  const [row] = await tx
    .select({
      id: exchangeEvents.id,
      publicCode: exchangeEvents.publicCode,
      title: exchangeEvents.title,
      hostMemberId: exchangeEvents.hostMemberId,
      hostIsActive: members.isActive,
      hostApproval: members.approvalStatus,
      hiddenAt: exchangeEvents.hiddenAt,
      status: exchangeEvents.status,
      endAt: exchangeEvents.endAt,
      cancelledAt: exchangeEvents.cancelledAt,
      commentsLocked: exchangeEvents.commentsLocked,
    })
    .from(exchangeEvents)
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .where(where)
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    publicCode: row.publicCode,
    title: row.title,
    hostMemberId: row.hostMemberId,
    hostActive: row.hostIsActive && row.hostApproval === "approved",
    hidden: row.hiddenAt !== null,
    status: row.status,
    endAt: row.endAt,
    cancelledAt: row.cancelledAt,
    commentsLocked: row.commentsLocked,
  };
}

/**
 * Meta của buổi theo mã công khai, cache 60s. Dựng lại wrapper mỗi lần gọi để
 * key `["xcmeta", code]` đi theo mã; tag "exchange" có sẵn nên ẩn/huỷ buổi của
 * G2b làm mới luôn, còn khoá bình luận dùng `commentMetaTag(code)`.
 */
export function getCommentEventMetaCached(
  code: string,
): Promise<CommentEventMeta | null> {
  return unstable_cache(
    async () => readMeta(db, eq(exchangeEvents.publicCode, code)),
    ["xcmeta", code],
    { revalidate: 60, tags: ["exchange", commentMetaTag(code)] },
  )();
}

/**
 * Trạng thái ghi. Đóng khi buổi bị ẩn, host hết hiệu lực, hoặc quá 7 ngày sau
 * mốc kết thúc (buổi huỷ tính từ lúc huỷ). Khoá của host chỉ có nghĩa khi
 * không thuộc các trường hợp đóng.
 */
export function commentWriteState(
  ev: Pick<
    CommentEventMeta,
    "commentsLocked" | "hidden" | "endAt" | "cancelledAt"
  >,
  hostActive: boolean,
  now: Date,
): CommentWriteState {
  if (ev.hidden || !hostActive) return "closed";
  const base = Date.parse(ev.cancelledAt ?? ev.endAt);
  // Ngày hỏng thì so sánh với NaN luôn sai, tức là mở mãi: đóng cho an toàn.
  if (
    Number.isNaN(base) ||
    now.getTime() > base + COMMENT_OPEN_AFTER_END_DAYS * 86_400_000
  ) {
    return "closed";
  }
  return ev.commentsLocked ? "locked" : "open";
}

/**
 * Quyền của một người xem trên một buổi. Theo `code` (trang công khai) lấy meta
 * từ cache nên khách không tốn truy vấn nào; theo `eventId` hoặc `fresh: true`
 * (mọi action ghi) đọc thẳng trong `tx` để không quyết định trên số liệu cũ.
 * Null khi không có buổi, hoặc buổi ẩn / host hết hiệu lực mà người xem không
 * phải host và không có đăng ký (cùng luật hiển thị với G2b).
 */
export async function loadCommentContext(
  tx: DbOrTx,
  by: { code: string } | { eventId: number },
  viewer: { id: number } | null,
  now: Date,
  opts?: { fresh?: boolean },
): Promise<CommentContext | null> {
  let event: CommentEventMeta | null;
  if ("code" in by && !opts?.fresh) {
    event = await getCommentEventMetaCached(by.code);
  } else {
    event = await readMeta(
      tx,
      "code" in by
        ? eq(exchangeEvents.publicCode, by.code)
        : eq(exchangeEvents.id, by.eventId),
    );
  }
  if (!event) return null;

  const writeState = commentWriteState(event, event.hostActive, now);
  const visible = !event.hidden && event.hostActive;

  if (!viewer) {
    if (!visible) return null;
    return {
      event,
      role: "guest",
      canRead: { qa: true, group: false },
      canWrite: { qa: false, group: false },
      writeState,
      blocked: false,
    };
  }

  const isHost = viewer.id === event.hostMemberId;
  let role: CommentRole = "member";
  let blocked = false;
  if (isHost) {
    role = "host";
  } else {
    const [reg] = await tx
      .select({ status: exchangeRegistrations.status })
      .from(exchangeRegistrations)
      .where(
        and(
          eq(exchangeRegistrations.eventId, event.id),
          eq(exchangeRegistrations.memberId, viewer.id),
        ),
      )
      .limit(1);
    if (!visible && !reg) return null;
    // Điểm danh (checked_in) là cờ trên đăng ký `approved`, không phải trạng thái riêng.
    if (reg?.status === "approved") role = "approved";
    blocked = await isBlockedByHost(tx, event.hostMemberId, viewer.id);
  }

  const inGroup = role === "approved" || role === "host";
  const canRead = { qa: true, group: inGroup };
  const open = writeState === "open" && !blocked;
  return {
    event,
    role,
    canRead,
    canWrite: { qa: open, group: open && inGroup },
    writeState,
    blocked,
  };
}

/**
 * Nạp một bình luận trong phạm vi quyền của người xem. Bình luận của buổi khác,
 * của khu không được đọc, hoặc `held` của người khác (host thì được) đều là null.
 * `authorAnyChannel`: tác giả vẫn nạp được bình luận của chính mình ở khu đã mất
 * quyền đọc, để còn xoá được.
 */
export async function loadCommentInEvent(
  tx: DbOrTx,
  commentId: number,
  ctx: CommentContext,
  viewerId: number | null,
  opts?: { authorAnyChannel?: boolean },
): Promise<CommentRowLite | null> {
  const [row] = await tx
    .select({
      id: exchangeComments.id,
      eventId: exchangeComments.eventId,
      channel: exchangeComments.channel,
      parentId: exchangeComments.parentId,
      authorMemberId: exchangeComments.authorMemberId,
      status: exchangeComments.status,
      pinned: exchangeComments.pinned,
      createdAt: exchangeComments.createdAt,
    })
    .from(exchangeComments)
    .where(eq(exchangeComments.id, commentId))
    .limit(1);
  if (!row || row.eventId !== ctx.event.id) return null;

  const isAuthor = viewerId !== null && row.authorMemberId === viewerId;
  if (!ctx.canRead[row.channel] && !(opts?.authorAnyChannel && isAuthor)) {
    return null;
  }
  if (row.status === "held" && !isAuthor && ctx.role !== "host") return null;
  return row;
}

/** Mọi action nhận `commentId` đi qua đây: đọc buổi của bình luận rồi kiểm quyền. */
export async function loadCommentWithContext(
  tx: DbOrTx,
  commentId: number,
  viewer: { id: number } | null,
  now: Date,
  opts?: { authorAnyChannel?: boolean },
): Promise<{ ctx: CommentContext; comment: CommentRowLite } | null> {
  const [row] = await tx
    .select({ eventId: exchangeComments.eventId })
    .from(exchangeComments)
    .where(eq(exchangeComments.id, commentId))
    .limit(1);
  if (!row) return null;
  const ctx = await loadCommentContext(
    tx,
    { eventId: row.eventId },
    viewer,
    now,
  );
  if (!ctx) return null;
  const comment = await loadCommentInEvent(
    tx,
    commentId,
    ctx,
    viewer?.id ?? null,
    opts,
  );
  return comment ? { ctx, comment } : null;
}
