import { and, eq } from "drizzle-orm";
import {
  notificationDeliveries,
  notificationPrefs,
  notifications,
} from "@/db/schema";
import type { DbOrTx, Tx } from "@/db/tx";
import { isNotificationsEnabled, notify } from "./notify";
import { memberName, superadminRecipients } from "./recipients";

type MemberAccountKind =
  | "account_approved"
  | "account_rejected"
  | "group_request_declined"
  | "account_merged"
  | "password_changed";

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
  facebook: "Facebook",
  zalo: "Zalo",
};

/** Tên hiển thị của phương thức đăng nhập trong tin gửi member. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

/**
 * Dời tin của member nguồn sang member đích khi gộp tài khoản, và xoá dòng
 * tuỳ chọn của nguồn (đích giữ tuỳ chọn riêng). Gọi trong tx của merge, TRƯỚC
 * khi xoá member nguồn.
 *
 * Không đụng `dedup_key`: UPDATE chỉ đổi recipient_id nên UNIQUE không thể bị
 * vi phạm. Hậu tố `:m{fromId}` ở lại trên dòng đã dời, vô hại vì id nguồn đã
 * bị xoá và mọi khoá cũ vẫn duy nhất.
 *
 * Email đang chờ gửi (`notification_deliveries`) cũng dời theo: lúc gửi outbox
 * kiểm điều kiện theo `recipient_id`, để id đã xoá thì mail bị bỏ oan.
 */
export async function repointNotifications(
  tx: Tx,
  fromMemberId: number,
  toMemberId: number,
): Promise<void> {
  await tx
    .update(notifications)
    .set({ recipientId: toMemberId })
    .where(
      and(
        eq(notifications.recipientType, "member"),
        eq(notifications.recipientId, fromMemberId),
      ),
    );
  await tx
    .update(notificationDeliveries)
    .set({ recipientId: toMemberId })
    .where(
      and(
        eq(notificationDeliveries.recipientType, "member"),
        eq(notificationDeliveries.recipientId, fromMemberId),
      ),
    );
  await tx
    .delete(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.recipientType, "member"),
        eq(notificationPrefs.recipientId, fromMemberId),
      ),
    );
}

/** Tin tài khoản gửi đúng member đó, bất kể trạng thái duyệt. */
export async function notifyMemberAccount(
  db: DbOrTx,
  input: {
    kind: MemberAccountKind;
    memberId: number;
    /** Phần sau tiền tố, ví dụ `approve`, `pwd`. */
    dedupBase: string;
    payload?: { byAdmin?: boolean };
    now?: Date;
  },
  gate?: boolean,
): Promise<void> {
  if (gate === false) return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  const now = input.now ?? new Date();
  await notify(db, {
    kind: input.kind,
    recipients: [{ type: "member", id: input.memberId }],
    payload: (input.payload ?? {}) as never,
    dedupBase: `${input.dedupBase}:${now.toISOString()}`,
    entity: { type: "member", id: input.memberId },
    now,
  });
}

/** `login_method_linked` / `login_method_unlinked`. */
export async function notifyLoginMethod(
  db: DbOrTx,
  kind: "login_method_linked" | "login_method_unlinked",
  memberId: number,
  provider: string,
  gate?: boolean,
): Promise<void> {
  if (gate === false) return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  const now = new Date();
  await notify(db, {
    kind,
    recipients: [{ type: "member", id: memberId }],
    payload: { provider: providerLabel(provider) },
    dedupBase: `oauth:${kind === "login_method_linked" ? "link" : "unlink"}:${provider}:m${memberId}:${now.toISOString()}`,
    entity: { type: "member", id: memberId },
    now,
  });
}

/**
 * Tin "đăng ký mới" gửi superadmin. Chỉ ý định vào nhóm mới gửi: tài khoản
 * giao lưu chưa xin vào nhóm không cần admin duyệt.
 */
export async function notifySignupPending(
  db: DbOrTx,
  input: {
    memberId: number;
    provider: string;
    signupIntent: "group" | "exchange";
  },
  gate?: boolean,
): Promise<void> {
  if (gate === false || input.signupIntent !== "group") return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  await notify(db, {
    kind: "signup_pending",
    recipients: await superadminRecipients(db),
    payload: {
      memberName: await memberName(db, input.memberId),
      provider: input.provider,
    },
    dedupBase: `signup:m${input.memberId}`,
    entity: { type: "member", id: input.memberId },
  });
}

/** Tài khoản giao lưu xin vào nhóm. */
export async function notifyGroupJoinRequest(
  db: DbOrTx,
  memberId: number,
  gate?: boolean,
): Promise<void> {
  if (gate === false) return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  const now = new Date();
  await notify(db, {
    kind: "group_join_request",
    recipients: await superadminRecipients(db),
    payload: { memberName: await memberName(db, memberId) },
    dedupBase: `joinreq:m${memberId}:${now.toISOString()}`,
    entity: { type: "member", id: memberId },
    now,
  });
}

/** Sân mới do member đề xuất, chờ superadmin duyệt. */
export async function notifyVenuePending(
  db: DbOrTx,
  input: { venueId: number; venueName: string; proposerId: number },
  gate?: boolean,
): Promise<void> {
  if (gate === false) return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  await notify(db, {
    kind: "venue_pending",
    recipients: await superadminRecipients(db),
    payload: {
      venueName: input.venueName,
      proposerName: await memberName(db, input.proposerId),
    },
    dedupBase: `venue:v${input.venueId}`,
    entity: { type: "venue", id: input.venueId },
  });
}

/** Báo người đề xuất khi sân được duyệt hoặc bị ẩn. */
export async function notifyVenueStatus(
  db: DbOrTx,
  input: {
    venueId: number;
    venueName: string;
    status: "approved" | "hidden";
    proposerId: number | null;
  },
  gate?: boolean,
): Promise<void> {
  if (gate === false || input.proposerId == null) return;
  if (gate === undefined && !(await isNotificationsEnabled(db))) return;
  const now = new Date();
  await notify(db, {
    kind: input.status === "approved" ? "venue_approved" : "venue_hidden",
    recipients: [{ type: "member", id: input.proposerId }],
    payload: { venueName: input.venueName },
    dedupBase: `venuest:v${input.venueId}:${input.status}:${now.toISOString()}`,
    entity: { type: "venue", id: input.venueId },
    now,
  });
}
