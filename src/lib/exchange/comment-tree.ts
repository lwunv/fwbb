// Thuần (không DB, không server-only): client và server dùng chung.
import {
  COMMENT_EDIT_WINDOW_MS,
  type CommentChannel,
  type CommentSort,
  type CommentStatus,
} from "./constants";

/** Dòng bình luận JSON thuần từ SQL. `authorMemberId` chỉ dùng trong buildThreads. */
export type CommentRow = {
  id: number;
  parentId: number | null;
  channel: CommentChannel;
  authorMemberId: number | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  authorAvatarKey: string | null;
  /** Nick mới theo G2b (G2d quyết định 38); null khi dòng bị che nội dung. */
  authorIsNew: boolean | null;
  replyToName: string | null;
  body: string | null;
  status: CommentStatus;
  upvotes: number;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  /** Số con `visible`. */
  replyCount: number;
};

/** Cây trả về UI: không có member id ở bất kỳ tầng nào. */
export type CommentView = {
  id: number;
  parentId: number | null;
  author: {
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    isHost: boolean;
    /** Nhãn "Mới", cờ duy nhất người bình luận có thêm. */
    isNew: boolean;
  } | null;
  replyToName: string | null;
  body: string | null;
  state: CommentStatus;
  upvotes: number;
  pinned: boolean;
  edited: boolean;
  createdAt: string;
  mine: boolean;
  myVote: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canPin: boolean;
  moreReplies: number;
  replies: CommentView[];
};

export type BuildThreadsOpts = {
  hostMemberId: number;
  viewerId: number | null;
  isHost: boolean;
  myVotes: Set<number>;
  sort: CommentSort;
  now: Date;
  writeOpen: boolean;
};

const byOldest = (a: CommentRow, b: CommentRow) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id;

/**
 * Dựng cây trả lời. Dòng không có `body` (held/deleted/hidden lấy từ cache
 * công khai) chỉ là dòng giữ chỗ: không tác giả, không quyền nào, và bị bỏ
 * nếu không còn con nào hiện được. Trả lời mồ côi (cha không có trong rows)
 * bị bỏ để không lộ nội dung ngoài ngữ cảnh.
 */
export function buildThreads(
  rows: CommentRow[],
  opts: BuildThreadsOpts,
): CommentView[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<number, CommentRow[]>();
  const roots: CommentRow[] = [];
  for (const r of rows) {
    if (r.parentId === null) roots.push(r);
    else if (ids.has(r.parentId)) {
      const list = children.get(r.parentId) ?? [];
      list.push(r);
      children.set(r.parentId, list);
    }
  }

  const nowMs = opts.now.getTime();

  function toView(r: CommentRow): CommentView | null {
    const kids = (children.get(r.id) ?? []).slice().sort(byOldest);
    const replies = kids
      .map(toView)
      .filter((v): v is CommentView => v !== null);
    const hasBody = r.body !== null;
    if (!hasBody && replies.length === 0) return null;

    const mine =
      hasBody && opts.viewerId !== null && r.authorMemberId === opts.viewerId;
    const live = r.status === "visible" || r.status === "held";
    return {
      id: r.id,
      parentId: r.parentId,
      author:
        hasBody && r.authorName !== null
          ? {
              name: r.authorName,
              avatarUrl: r.authorAvatarUrl,
              avatarKey: r.authorAvatarKey,
              isHost:
                r.authorMemberId !== null &&
                r.authorMemberId === opts.hostMemberId,
              isNew: r.authorIsNew === true,
            }
          : null,
      replyToName: r.replyToName,
      body: r.body,
      state: r.status,
      upvotes: r.upvotes,
      pinned: r.pinned,
      edited: r.editedAt != null,
      createdAt: r.createdAt,
      mine,
      myVote: opts.myVotes.has(r.id),
      canEdit:
        mine &&
        live &&
        opts.writeOpen &&
        nowMs - new Date(r.createdAt).getTime() <= COMMENT_EDIT_WINDOW_MS,
      canDelete: hasBody && (mine || opts.isHost) && live,
      canApprove: hasBody && opts.isHost && r.status === "held",
      canPin:
        hasBody && opts.isHost && r.parentId === null && r.status === "visible",
      // replyCount chỉ đếm con visible, nên chỉ trừ con visible đã có trong rows.
      moreReplies: Math.max(
        0,
        r.replyCount - kids.filter((k) => k.status === "visible").length,
      ),
      replies,
    };
  }

  const cmp = (a: CommentRow, b: CommentRow) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (opts.sort === "top" && a.upvotes !== b.upvotes) {
      return b.upvotes - a.upvotes;
    }
    if (opts.sort === "new") return -byOldest(a, b);
    return byOldest(a, b);
  };

  return roots
    .slice()
    .sort(cmp)
    .map(toView)
    .filter((v): v is CommentView => v !== null);
}
