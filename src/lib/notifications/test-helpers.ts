import { appSettings } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";

/** Bật công tắc thông báo cho test tích hợp (mặc định tắt). */
export async function enableNotificationsForTest(db: DbOrTx): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "notificationsEnabled", value: "true" })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: "true" },
    });
}
