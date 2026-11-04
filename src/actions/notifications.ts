"use server";

import { and, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { members, notifications } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getUserFromCookie } from "@/lib/user-identity";
import {
  NOTIFICATION_CATALOG,
  type NotificationKind,
} from "@/lib/notifications/catalog";
import { isNotificationsEnabled } from "@/lib/notifications/notify";
import type { NotificationView } from "@/lib/notifications/render";

type Scope = "member" | "admin";
type Cursor = { createdAt: string; id: number };

const PAGE_SIZE = 20;
const COUNT_CAP = 100;

/** Tin thuộc nhóm "account": thứ duy nhất member bị từ chối còn được xem. */
const ACCOUNT_KINDS = (
  Object.keys(NOTIFICATION_CATALOG) as NotificationKind[]
).filter((k) => NOTIFICATION_CATALOG[k].group === "account");

type Viewer = {
  recipientType: Scope;
  recipientId: number;
  /** null = không giới hạn kind; mảng = chỉ các kind này (lọc ngay trong SQL). */
  allowedKinds: NotificationKind[] | null;
};

/**
 * Xác định người xem từ cookie. Member phải còn `isActive`; member `rejected`
 * chỉ thấy tin nhóm account. Tài khoản giao lưu `pending` thấy tin của mình.
 * Người nhận luôn lấy từ phiên, không từ tham số client (chống IDOR).
 */
async function resolveViewer(scope: Scope): Promise<Viewer | null> {
  if (scope === "admin") {
    const auth = await requireAdmin();
    if ("error" in auth) return null;
    const id = Number(auth.admin.sub);
    if (!Number.isInteger(id)) return null;
    return { recipientType: "admin", recipientId: id, allowedKinds: null };
  }
  const user = await getUserFromCookie();
  if (!user) return null;
  const [member] = await db
    .select({
      isActive: members.isActive,
      approvalStatus: members.approvalStatus,
    })
    .from(members)
    .where(eq(members.id, user.memberId))
    .limit(1);
  if (!member || !member.isActive) return null;
  return {
    recipientType: "member",
    recipientId: user.memberId,
    allowedKinds: member.approvalStatus === "rejected" ? ACCOUNT_KINDS : null,
  };
}

function viewerFilter(v: Viewer): SQL[] {
  const conds: SQL[] = [
    eq(notifications.recipientType, v.recipientType),
    eq(notifications.recipientId, v.recipientId),
  ];
  if (v.allowedKinds) conds.push(inArray(notifications.kind, v.allowedKinds));
  return conds;
}

/** Đếm chưa đọc, chặn ở 100 ngay trong SQL để không quét cả bảng. */
export async function getUnreadNotificationCount(
  scope: Scope,
): Promise<number> {
  const viewer = await resolveViewer(scope);
  if (!viewer) return 0;
  if (!(await isNotificationsEnabled(db))) return 0;
  const capped = db
    .select({ one: notifications.id })
    .from(notifications)
    .where(and(...viewerFilter(viewer), isNull(notifications.readAt)))
    .limit(COUNT_CAP)
    .as("capped");
  const [row] = await db.select({ n: count() }).from(capped);
  return row?.n ?? 0;
}

/** 20 tin mới nhất trước, phân trang theo (createdAt, id) giảm dần. */
export async function listNotifications(
  scope: Scope,
  cursor: Cursor | null,
): Promise<
  { items: NotificationView[]; nextCursor: Cursor | null } | { error: string }
> {
  const viewer = await resolveViewer(scope);
  if (!viewer) return { error: "Unauthorized" };
  if (!(await isNotificationsEnabled(db))) {
    return { items: [], nextCursor: null };
  }
  const conds = viewerFilter(viewer);
  if (cursor) {
    const older = or(
      lt(notifications.createdAt, cursor.createdAt),
      and(
        eq(notifications.createdAt, cursor.createdAt),
        lt(notifications.id, cursor.id),
      ),
    );
    if (older) conds.push(older);
  }
  // Lấy dư 1 dòng để biết còn trang sau mà không cần đếm.
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      payload: notifications.payload,
      mandatory: notifications.mandatory,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > PAGE_SIZE && last
      ? { createdAt: last.createdAt, id: last.id }
      : null;
  // `kind` lạ (bản mới ghi, bản cũ đọc) vẫn trả về; render.ts lo phần hiển thị.
  const items = page.map((r) => ({
    ...r,
    kind: r.kind as NotificationKind,
  })) satisfies NotificationView[];
  return { items, nextCursor };
}

/** Đánh dấu 1 tin đã đọc; điều kiện người nhận nằm trong WHERE nên id của người khác đổi 0 dòng. */
export async function markNotificationRead(
  scope: Scope,
  id: number,
): Promise<{ success: true } | { error: string }> {
  if (!Number.isInteger(id)) return { error: "Invalid id" };
  const viewer = await resolveViewer(scope);
  if (!viewer) return { error: "Unauthorized" };
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(
      and(
        eq(notifications.id, id),
        ...viewerFilter(viewer),
        isNull(notifications.readAt),
      ),
    );
  return { success: true };
}

export async function markAllNotificationsRead(
  scope: Scope,
): Promise<{ success: true } | { error: string }> {
  const viewer = await resolveViewer(scope);
  if (!viewer) return { error: "Unauthorized" };
  await db
    .update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(and(...viewerFilter(viewer), isNull(notifications.readAt)));
  return { success: true };
}
