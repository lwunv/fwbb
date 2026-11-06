import "server-only";
import type { Tx } from "@/db/tx";
import { notify } from "./notify";
import type { Recipient } from "./recipients";

/*
 * Tin bình luận giao lưu (G2c), chỉ chuông. Cùng quy ước với exchange-events:
 * nhận `tx` của giao dịch nghiệp vụ và `gate` do caller đã đọc; `gate` false
 * thì không ghi gì. Payload không có tên và không có nội dung bình luận.
 *
 * Chống trùng theo giờ UTC để mười câu hỏi trong một giờ chỉ báo host một lần.
 */

type EventRef = {
  id: number;
  publicCode: string;
  title: string;
  hostMemberId: number;
};

const member = (id: number): Recipient => ({ type: "member", id });
const hourUTC = (now: Date) => now.toISOString().slice(0, 13);
const entity = (event: EventRef) => ({
  type: "exchange_event" as const,
  id: event.id,
});
const ref = (event: EventRef) => ({
  eventCode: event.publicCode,
  eventTitle: event.title,
});

/**
 * Gọi mỗi khi một bình luận trở thành `visible` (viết mới, sửa từ `held`,
 * host duyệt, admin duyệt). Tác giả không bao giờ nhận tin về bình luận của
 * chính mình.
 */
export async function notifyCommentVisible(
  tx: Tx,
  input: {
    event: EventRef;
    comment: {
      id: number;
      channel: "qa" | "group";
      parentId: number | null;
      authorMemberId: number;
    };
    parentAuthorId: number | null;
    replyToMemberId: number | null;
    groupMemberIds: number[];
  },
  gate: boolean,
  now: Date,
): Promise<void> {
  if (!gate) return;
  const { event, comment } = input;
  const author = comment.authorMemberId;
  const hour = hourUTC(now);

  if (comment.parentId === null) {
    if (author !== event.hostMemberId) {
      await notify(tx, {
        kind: "exchange_comment_new",
        recipients: [member(event.hostMemberId)],
        payload: { ...ref(event), channel: comment.channel },
        dedupBase: `xcn:e${event.id}:${hour}`,
        entity: entity(event),
        now,
        gate,
      });
    } else if (comment.channel === "group") {
      await notify(tx, {
        kind: "exchange_comment_host_post",
        recipients: input.groupMemberIds
          .filter((id) => id !== author)
          .map(member),
        payload: ref(event),
        dedupBase: `xch:c${comment.id}`,
        entity: entity(event),
        now,
        gate,
      });
    }
    return;
  }

  const ids = new Set<number>();
  for (const id of [input.parentAuthorId, input.replyToMemberId]) {
    if (id === null || id === author) continue;
    // Nhóm buổi là khu kín: người đã rời danh sách duyệt không còn được báo.
    if (
      comment.channel === "group" &&
      id !== event.hostMemberId &&
      !input.groupMemberIds.includes(id)
    )
      continue;
    ids.add(id);
  }
  await notify(tx, {
    kind: "exchange_comment_reply",
    recipients: [...ids].map(member),
    payload: { ...ref(event), channel: comment.channel },
    dedupBase: `xcr:e${event.id}:${hour}`,
    entity: entity(event),
    now,
    gate,
  });
}

/** Host nhận tin khi có bình luận vào hàng chờ duyệt. */
export async function notifyCommentHeld(
  tx: Tx,
  input: { event: EventRef; commentId: number },
  gate: boolean,
  now: Date,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: "exchange_comment_held",
    recipients: [member(input.event.hostMemberId)],
    payload: ref(input.event),
    dedupBase: `xchd:e${input.event.id}:${hourUTC(now)}`,
    entity: entity(input.event),
    now,
    gate,
  });
}
