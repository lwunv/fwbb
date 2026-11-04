import { eq } from "drizzle-orm";
import { appSettings } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { resolveGlobal } from "@/lib/settings-resolve";

/**
 * Công tắc `notificationsEnabled`: đúng 1 truy vấn `app_settings`. Mọi helper
 * sự kiện gọi hàm này trước mọi truy vấn khác và return ngay khi tắt.
 * Tách khỏi `notify.ts` để outbox dùng được mà không tạo vòng import.
 */
export async function isNotificationsEnabled(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "notificationsEnabled"))
    .limit(1);
  return resolveGlobal(rows).notificationsEnabled === true;
}
