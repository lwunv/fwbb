import type { CommentPage } from "@/actions/exchange-comments";
import type { CommentView } from "@/lib/exchange/comment-tree";

/** Dữ liệu mẫu cho test khu bình luận. Không có id thành viên hay liên hệ nào ở đây. */
export function makeView(over: Partial<CommentView> = {}): CommentView {
  return {
    id: 1,
    parentId: null,
    author: { name: "An", avatarUrl: null, avatarKey: null, isHost: false },
    replyToName: null,
    body: "Sân có điều hòa không?",
    state: "visible",
    upvotes: 2,
    pinned: false,
    edited: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    mine: false,
    myVote: false,
    canEdit: false,
    canDelete: false,
    canApprove: false,
    canPin: false,
    moreReplies: 0,
    replies: [],
    ...over,
  };
}

export function makePage(over: Partial<CommentPage> = {}): CommentPage {
  return {
    channel: "qa",
    sort: "top",
    roots: [],
    hostHeld: [],
    hasMore: false,
    nextOffset: null,
    total: 0,
    writeState: "open",
    role: "member",
    canRead: { qa: true, group: false },
    canWrite: true,
    needsCaptcha: false,
    unread: false,
    newestAt: null,
    ...over,
  };
}
