import { and, eq, inArray } from "drizzle-orm";
import { appSettings, notificationPrefs, notifications } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { resolveGlobal } from "@/lib/settings-resolve";
import {
  NOTIFICATION_CATALOG,
  type NotificationKind,
  type NotificationPayloads,
} from "./catalog";
import type { Recipient } from "./recipients";

export type EntityType = NonNullable<
  typeof notifications.$inferInsert.entityType
>;

export type NotifyInput<K extends NotificationKind> = {
  kind: K;
  recipients: Recipient[];
  payload: NotificationPayloads[K];
  /** Khoá chống trùng; mỗi người nhận được hậu tố `:m{id}` / `:a{id}`. */
  dedupBase: string;
  entity?: { type: EntityType; id: number };
  now?: Date;
};

/**
 * Công tắc `notificationsEnabled`: đúng 1 truy vấn `app_settings`. Mọi helper
 * sự kiện gọi hàm này trước mọi truy vấn khác và return ngay khi tắt.
 */
export async function isNotificationsEnabled(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "notificationsEnabled"))
    .limit(1);
  return resolveGlobal(rows).notificationsEnabled === true;
}

const keyOf = (r: Recipient) => `${r.type === "member" ? "m" : "a"}${r.id}`;

/**
 * Ghi tin cho danh sách người nhận. Lỗi DB được ném ra để transaction nghiệp
 * vụ của caller rollback (spec 4.9). Trùng `dedup_key` thì bỏ qua êm.
 */
export async function notify<K extends NotificationKind>(
  db: DbOrTx,
  input: NotifyInput<K>,
): Promise<{ inserted: number; ids: number[] }> {
  const none = { inserted: 0, ids: [] as number[] };
  if (input.recipients.length === 0) return none;
  if (!(await isNotificationsEnabled(db))) return none;

  const def = NOTIFICATION_CATALOG[input.kind];
  const seen = new Set<string>();
  let recipients = input.recipients.filter((r) => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!def.mandatory) {
    const muted = await db
      .select({
        recipientType: notificationPrefs.recipientType,
        recipientId: notificationPrefs.recipientId,
        mutedGroups: notificationPrefs.mutedGroups,
      })
      .from(notificationPrefs)
      .where(
        and(
          inArray(
            notificationPrefs.recipientType,
            Array.from(new Set(recipients.map((r) => r.type))),
          ),
          inArray(
            notificationPrefs.recipientId,
            recipients.map((r) => r.id),
          ),
        ),
      );
    const skip = new Set(
      muted
        .filter(
          (p) =>
            Array.isArray(p.mutedGroups) && p.mutedGroups.includes(def.group),
        )
        .map(
          (p) => `${p.recipientType === "member" ? "m" : "a"}${p.recipientId}`,
        ),
    );
    recipients = recipients.filter((r) => !skip.has(keyOf(r)));
  }
  if (recipients.length === 0) return none;

  const createdAt = (input.now ?? new Date()).toISOString();
  const rows = await db
    .insert(notifications)
    .values(
      recipients.map((r) => ({
        recipientType: r.type,
        recipientId: r.id,
        kind: input.kind,
        entityType: input.entity?.type ?? null,
        entityId: input.entity?.id ?? null,
        payload: input.payload as Record<string, unknown>,
        mandatory: def.mandatory,
        createdAt,
        dedupKey: `${input.dedupBase}:${keyOf(r)}`,
      })),
    )
    .onConflictDoNothing({ target: notifications.dedupKey })
    .returning({ id: notifications.id });

  // Task 15 xếp hàng email ở đây.
  return { inserted: rows.length, ids: rows.map((r) => r.id) };
}
