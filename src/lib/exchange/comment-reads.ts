import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import type { DbOrTx } from "@/db/tx";
import { exchangeCommentReads, exchangeRegistrations } from "@/db/schema";
import { commentTag, type CommentContext } from "./comment-access";
import type { CommentRow } from "./comment-tree";
import {
  COMMENT_COUNT_WINDOW_DAYS,
  COMMENT_MAX_ROWS,
  COMMENT_PAGE_ROOTS,
  COMMENT_PAGE_TIER1,
  COMMENT_PAGE_TIER2,
  COMMENT_REPLIES_PAGE,
  LIST_LIMIT,
  type CommentChannel,
  type CommentSort,
} from "./constants";

/** Tầng 2 kèm mỗi tầng 1 khi mở "Xem thêm trả lời" của một gốc: 10 + 10×4 = 50 dòng. */
const REPLY_TIER2_PER =
  (COMMENT_MAX_ROWS - COMMENT_REPLIES_PAGE) / COMMENT_REPLIES_PAGE;

// Dòng giữ chỗ trong trang công khai: không nội dung, không tác giả ngay từ SQL,
// để cache dùng chung không bao giờ chứa chữ của bình luận chờ duyệt hay đã gỡ.
const MASK_PUBLIC = sql.raw(`('held','deleted','hidden')`);
// Bản đầy đủ cho tác giả hoặc host: chỉ còn che dòng đã xoá hoặc bị ẩn.
const MASK_REMOVED = sql.raw(`('deleted','hidden')`);

type RawRow = Omit<CommentRow, "pinned" | "replyCount"> & { pinned: number };

const inList = (ids: number[]): SQL =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

function selectComments(mask: SQL): SQL {
  const hide = sql`c.status IN ${mask}`;
  return sql`SELECT c.id AS id, c.parent_id AS parentId, c.channel AS channel,
    CASE WHEN ${hide} THEN NULL ELSE c.author_member_id END AS authorMemberId,
    CASE WHEN ${hide} THEN NULL ELSE m.name END AS authorName,
    CASE WHEN ${hide} THEN NULL ELSE m.avatar_url END AS authorAvatarUrl,
    CASE WHEN ${hide} THEN NULL ELSE m.avatar_key END AS authorAvatarKey,
    CASE WHEN ${hide} OR c.reply_to_member_id IS NULL
      OR c.reply_to_member_id = p.author_member_id THEN NULL ELSE rm.name END AS replyToName,
    CASE WHEN ${hide} THEN NULL ELSE c.body END AS body,
    c.status AS status, c.upvotes AS upvotes, c.pinned AS pinned,
    CASE WHEN ${hide} THEN NULL ELSE c.edited_at END AS editedAt,
    c.created_at AS createdAt
  FROM exchange_comments c
  JOIN members m ON m.id = c.author_member_id
  LEFT JOIN exchange_comments p ON p.id = c.parent_id
  LEFT JOIN members rm ON rm.id = c.reply_to_member_id`;
}

/** JSON thuần (qua được Data Cache): số là số, cờ là boolean. */
function toRow(r: RawRow, replyCount: number): CommentRow {
  return {
    id: Number(r.id),
    parentId: r.parentId === null ? null : Number(r.parentId),
    channel: r.channel,
    authorMemberId: r.authorMemberId === null ? null : Number(r.authorMemberId),
    authorName: r.authorName,
    authorAvatarUrl: r.authorAvatarUrl,
    authorAvatarKey: r.authorAvatarKey,
    replyToName: r.replyToName,
    body: r.body,
    status: r.status,
    upvotes: Number(r.upvotes),
    pinned: Boolean(r.pinned),
    editedAt: r.editedAt,
    createdAt: r.createdAt,
    replyCount,
  };
}

/** `perParent` con đầu tiên (cũ nhất) của mỗi cha, mọi trạng thái. */
async function firstChildren(
  tx: DbOrTx,
  parentIds: number[],
  perParent: number,
): Promise<RawRow[]> {
  if (parentIds.length === 0) return [];
  return tx.all<RawRow>(sql`${selectComments(MASK_PUBLIC)}
    JOIN (
      SELECT id AS kid,
        ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at, id) AS rn
      FROM exchange_comments WHERE parent_id IN ${inList(parentIds)}
    ) k ON k.kid = c.id
    WHERE k.rn <= ${perParent}
    ORDER BY c.created_at, c.id`);
}

/** Số con `visible` của từng cha, 1 truy vấn. */
async function visibleChildCounts(
  tx: DbOrTx,
  parentIds: number[],
): Promise<Map<number, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await tx.all<{ parentId: number; n: number }>(sql`
    SELECT parent_id AS parentId, COUNT(*) AS n FROM exchange_comments
    WHERE parent_id IN ${inList(parentIds)} AND status = 'visible'
    GROUP BY parent_id`);
  return new Map(rows.map((r) => [Number(r.parentId), Number(r.n)]));
}

async function withCounts(
  tx: DbOrTx,
  raws: RawRow[],
  parents: RawRow[],
): Promise<CommentRow[]> {
  const counts = await visibleChildCounts(
    tx,
    parents.map((r) => Number(r.id)),
  );
  return raws.map((r) => toRow(r, counts.get(Number(r.id)) ?? 0));
}

/**
 * Một trang của một khu: tối đa 10 gốc (mọi trạng thái, sắp như `buildThreads`),
 * 2 tầng 1 đầu mỗi gốc, 1 tầng 2 đầu mỗi tầng 1, tổng tối đa 50 dòng. Phần còn
 * lại hiện qua `moreReplies` và `loadReplyRows`. `total` là số bình luận hiện.
 */
export async function loadThreadRows(
  tx: DbOrTx,
  eventId: number,
  channel: CommentChannel,
  sort: CommentSort,
  offset: number,
): Promise<{ rows: CommentRow[]; hasMore: boolean; total: number }> {
  const order =
    sort === "top"
      ? sql`c.pinned DESC, c.upvotes DESC, c.created_at ASC, c.id ASC`
      : sql`c.pinned DESC, c.created_at DESC, c.id DESC`;
  const found = await tx.all<RawRow>(sql`${selectComments(MASK_PUBLIC)}
    WHERE c.event_id = ${eventId} AND c.channel = ${channel}
      AND c.parent_id IS NULL
    ORDER BY ${order}
    LIMIT ${COMMENT_PAGE_ROOTS + 1} OFFSET ${offset}`);
  const hasMore = found.length > COMMENT_PAGE_ROOTS;
  const roots = found.slice(0, COMMENT_PAGE_ROOTS);
  const tier1 = await firstChildren(
    tx,
    roots.map((r) => Number(r.id)),
    COMMENT_PAGE_TIER1,
  );
  const tier2 = await firstChildren(
    tx,
    tier1.map((r) => Number(r.id)),
    COMMENT_PAGE_TIER2,
  );
  const rows = await withCounts(
    tx,
    [...roots, ...tier1, ...tier2],
    [...roots, ...tier1],
  );
  const [{ n }] = await tx.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM exchange_comments
    WHERE event_id = ${eventId} AND channel = ${channel} AND status = 'visible'`);
  return { rows, hasMore, total: Number(n) };
}

/**
 * "Xem thêm trả lời". Gốc: 10 tầng 1 kèm tối đa 4 tầng 2 mỗi cái. Tầng 1: tối
 * đa 50 tầng 2. Không trả chính bình luận được mở, nên luôn ≤ 50 dòng.
 */
export async function loadReplyRows(
  tx: DbOrTx,
  commentId: number,
  offset: number,
): Promise<{ rows: CommentRow[]; hasMore: boolean }> {
  const [anchor] = await tx.all<{ parentId: number | null }>(sql`
    SELECT parent_id AS parentId FROM exchange_comments WHERE id = ${commentId}`);
  if (!anchor) return { rows: [], hasMore: false };
  const isRoot = anchor.parentId === null;
  const pageSize = isRoot ? COMMENT_REPLIES_PAGE : COMMENT_MAX_ROWS;
  const found = await tx.all<RawRow>(sql`${selectComments(MASK_PUBLIC)}
    WHERE c.parent_id = ${commentId}
    ORDER BY c.created_at, c.id
    LIMIT ${pageSize + 1} OFFSET ${offset}`);
  const hasMore = found.length > pageSize;
  const kids = found.slice(0, pageSize);
  if (!isRoot) return { rows: kids.map((r) => toRow(r, 0)), hasMore };
  const tier2 = await firstChildren(
    tx,
    kids.map((r) => Number(r.id)),
    REPLY_TIER2_PER,
  );
  return { rows: await withCounts(tx, [...kids, ...tier2], kids), hasMore };
}

/**
 * Trang Hỏi đáp dùng chung cho mọi người xem, kể cả khách: khách không chạm DB
 * khi cache còn. Khu Nhóm buổi KHÔNG BAO GIỜ đi qua đây (kênh cố định "qa").
 */
export function getPublicQaPageCached(
  eventId: number,
  sort: CommentSort,
  offset: number,
): Promise<{ rows: CommentRow[]; hasMore: boolean; total: number }> {
  return unstable_cache(
    () => loadThreadRows(db, eventId, "qa", sort, offset),
    ["xcmt", String(eventId), "qa", sort, String(offset)],
    { tags: [commentTag(eventId)], revalidate: 60 },
  )();
}

export type ViewerOverlay = {
  myVotes: Set<number>;
  upvotes: Map<number, number>;
  heldFull: CommentRow[];
  hostHeld: CommentRow[];
};

/**
 * Phần riêng của người đã đăng nhập, đọc theo request: phiếu của mình, số
 * Hữu ích mới nhất (Hữu ích không làm mới cache), bản đầy đủ của dòng `held`
 * trên trang mà mình là tác giả hoặc host. Host ở trang đầu có thêm hàng chờ
 * duyệt của khu (`opts`), mới nhất trước.
 */
export async function loadViewerOverlay(
  tx: DbOrTx,
  ctx: CommentContext,
  viewerId: number,
  rows: CommentRow[],
  opts?: { channel: CommentChannel; offset: number },
): Promise<ViewerOverlay> {
  const isHost = ctx.role === "host";
  const out: ViewerOverlay = {
    myVotes: new Set(),
    upvotes: new Map(),
    heldFull: [],
    hostHeld: [],
  };
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const votes = await tx.all<{ id: number }>(sql`
      SELECT comment_id AS id FROM exchange_comment_votes
      WHERE member_id = ${viewerId} AND comment_id IN ${inList(ids)}`);
    out.myVotes = new Set(votes.map((v) => Number(v.id)));
    const fresh = await tx.all<{ id: number; upvotes: number }>(sql`
      SELECT id, upvotes FROM exchange_comments WHERE id IN ${inList(ids)}`);
    out.upvotes = new Map(fresh.map((f) => [Number(f.id), Number(f.upvotes)]));

    const held = rows.filter((r) => r.status === "held");
    if (held.length > 0) {
      const replyCount = new Map(held.map((r) => [r.id, r.replyCount]));
      const raws = await tx.all<RawRow>(sql`${selectComments(MASK_REMOVED)}
        WHERE c.id IN ${inList(held.map((r) => r.id))} AND c.status = 'held'
          ${isHost ? sql`` : sql`AND c.author_member_id = ${viewerId}`}`);
      out.heldFull = raws.map((r) =>
        toRow(r, replyCount.get(Number(r.id)) ?? 0),
      );
    }
  }
  if (isHost && opts?.offset === 0) {
    const raws = await tx.all<RawRow>(sql`${selectComments(MASK_REMOVED)}
      WHERE c.event_id = ${ctx.event.id} AND c.channel = ${opts.channel}
        AND c.status = 'held'
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${LIST_LIMIT}`);
    out.hostHeld = raws.map((r) => toRow(r, 0));
  }
  return out;
}

/** Thay dòng giữ chỗ `held` bằng bản đầy đủ và số Hữu ích bằng số mới. */
export function applyViewerOverlay(
  rows: CommentRow[],
  overlay: ViewerOverlay,
): CommentRow[] {
  const full = new Map(overlay.heldFull.map((r) => [r.id, r]));
  return rows.map((r) => {
    const base = full.get(r.id) ?? r;
    return { ...base, upvotes: overlay.upvotes.get(r.id) ?? base.upvotes };
  });
}

export type NewCommentEvent = {
  id: number;
  /** Host hoặc đăng ký `approved`: đọc được khu Nhóm buổi. */
  groupAccess: boolean;
  endAt: string;
  cancelledAt: string | null;
};

/**
 * Câu đếm bình luận mới của người khác kể từ mốc đọc của từng khu. Không alias
 * `exchange_comments` để EXPLAIN QUERY PLAN báo đúng tên bảng; cả hai nhánh
 * đi index (event_id, channel, created_at). Cần ít nhất một danh sách khác rỗng.
 */
export function newCommentsQuery(
  memberId: number,
  qaIds: number[],
  groupIds: number[],
): SQL {
  const branch = (channel: CommentChannel, ids: number[], mark: SQL): SQL =>
    sql`SELECT exchange_comments.event_id AS event_id FROM exchange_comments
      LEFT JOIN exchange_comment_reads r
        ON r.event_id = exchange_comments.event_id AND r.member_id = ${memberId}
      WHERE exchange_comments.event_id IN ${inList(ids)}
        AND exchange_comments.channel = ${channel}
        AND exchange_comments.status = 'visible'
        AND exchange_comments.author_member_id <> ${memberId}
        AND exchange_comments.created_at > COALESCE(${mark}, '')`;
  const parts: SQL[] = [];
  if (qaIds.length > 0) parts.push(branch("qa", qaIds, sql`r.last_read_at`));
  if (groupIds.length > 0)
    parts.push(branch("group", groupIds, sql`r.last_read_group_at`));
  return sql`SELECT event_id AS eventId, COUNT(*) AS n FROM (${sql.join(
    parts,
    sql` UNION ALL `,
  )}) GROUP BY event_id`;
}

/**
 * Số bình luận mới (của người khác, `visible`) theo buổi. Buổi đã kết thúc hoặc
 * huỷ quá 14 ngày trả 0 mà không truy vấn. `opts.qa = false` chỉ đếm Nhóm buổi.
 */
export async function newCommentsSince(
  tx: DbOrTx,
  memberId: number,
  events: NewCommentEvent[],
  now: Date,
  opts: { qa?: boolean } = {},
): Promise<[number, number][]> {
  const since = now.getTime() - COMMENT_COUNT_WINDOW_DAYS * 86_400_000;
  const live = events.filter(
    (e) => Date.parse(e.cancelledAt ?? e.endAt) > since,
  );
  const qaIds = opts.qa === false ? [] : live.map((e) => e.id);
  const groupIds = live.filter((e) => e.groupAccess).map((e) => e.id);
  const counts = new Map<number, number>();
  if (qaIds.length > 0 || groupIds.length > 0) {
    const rows = await tx.all<{ eventId: number; n: number }>(
      newCommentsQuery(memberId, qaIds, groupIds),
    );
    for (const r of rows) counts.set(Number(r.eventId), Number(r.n));
  }
  return events.map((e) => [e.id, counts.get(e.id) ?? 0]);
}

/** Host, đăng ký `approved`, hoặc có bất kỳ đăng ký nào ở buổi: được theo dõi mốc đọc. */
export async function isCommentReader(
  tx: DbOrTx,
  ctx: CommentContext,
  memberId: number,
): Promise<boolean> {
  if (ctx.role === "host" || ctx.role === "approved") return true;
  const [reg] = await tx
    .select({ id: exchangeRegistrations.id })
    .from(exchangeRegistrations)
    .where(
      and(
        eq(exchangeRegistrations.eventId, ctx.event.id),
        eq(exchangeRegistrations.memberId, memberId),
      ),
    )
    .limit(1);
  return reg !== undefined;
}

/** Khu đang xem có bình luận mới của người khác không. Chỉ host và người có đăng ký. */
export async function hasUnreadComments(
  tx: DbOrTx,
  ctx: CommentContext,
  memberId: number,
  channel: CommentChannel,
  now: Date,
): Promise<boolean> {
  if (!ctx.canRead[channel]) return false;
  if (!(await isCommentReader(tx, ctx, memberId))) return false;
  const [[, n]] = await newCommentsSince(
    tx,
    memberId,
    [
      {
        id: ctx.event.id,
        groupAccess: channel === "group",
        endAt: ctx.event.endAt,
        cancelledAt: ctx.event.cancelledAt,
      },
    ],
    now,
    { qa: channel === "qa" },
  );
  return n > 0;
}

/** Upsert mốc đọc của một khu; chỉ tiến lên, không bao giờ lùi. */
export async function markCommentsReadUpTo(
  tx: DbOrTx,
  eventId: number,
  memberId: number,
  channel: CommentChannel,
  at: string,
): Promise<void> {
  const set =
    channel === "qa"
      ? {
          lastReadAt: sql`MAX(COALESCE(${exchangeCommentReads.lastReadAt}, ''), excluded.last_read_at)`,
        }
      : {
          lastReadGroupAt: sql`MAX(COALESCE(${exchangeCommentReads.lastReadGroupAt}, ''), excluded.last_read_group_at)`,
        };
  await tx
    .insert(exchangeCommentReads)
    .values({
      eventId,
      memberId,
      ...(channel === "qa" ? { lastReadAt: at } : { lastReadGroupAt: at }),
    })
    .onConflictDoUpdate({
      target: [exchangeCommentReads.eventId, exchangeCommentReads.memberId],
      set,
    });
}
