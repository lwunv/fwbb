"use server";

import { db } from "@/db";
import { appSettings, courts, shuttlecockBrands } from "@/db/schema";
import { and, eq, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import {
  SETTINGS,
  type AppSettings,
  type SettingKey,
} from "@/lib/settings-registry";
import { resolveGlobal, serializeSetting } from "@/lib/settings-resolve";

export async function getAppName(): Promise<string> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "appName"),
  });
  return row?.value ?? "FWBB";
}

/**
 * Sân mặc định khi auto-create buổi chơi mới.
 * - Đọc `appSettings.defaultCourtId` trước (admin đã chỉ định).
 * - Nếu chưa set, fallback: tìm court active có tên chứa "THCS Tây Mỗ".
 * - Trả về null nếu không có court nào → caller skip pre-fill.
 *
 * Trả thẳng record để caller có cả `pricePerSession` (giá tháng) đặt làm
 * `courtPrice` ban đầu — admin có thể đổi qua CourtSelector.
 */
export async function getDefaultCourt() {
  const setting = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "defaultCourtId"),
  });
  const settingId = setting?.value ? parseInt(setting.value, 10) : null;
  if (settingId && Number.isFinite(settingId)) {
    const court = await db.query.courts.findFirst({
      where: and(eq(courts.id, settingId), eq(courts.isActive, true)),
    });
    if (court) return court;
  }
  // Fallback: tìm court active match "THCS Tây Mỗ".
  const fallback = await db.query.courts.findFirst({
    where: and(eq(courts.isActive, true), like(courts.name, "%THCS Tây Mỗ%")),
  });
  return fallback ?? null;
}

export async function setDefaultCourt(courtId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const exists = await db.query.courts.findFirst({
    where: eq(courts.id, courtId),
  });
  if (!exists) {
    const t = await getTranslations("serverErrors");
    return { error: t("courtNotExists") };
  }

  const value = String(courtId);
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "defaultCourtId"),
  });
  if (existing) {
    await db
      .update(appSettings)
      .set({ value })
      .where(eq(appSettings.key, "defaultCourtId"));
  } else {
    await db.insert(appSettings).values({ key: "defaultCourtId", value });
  }
  revalidatePath("/admin/courts");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/court-rent");
  return { success: true };
}

/**
 * Hãng cầu mặc định khi auto-create buổi chơi mới.
 * - Đọc `appSettings.defaultBrandId`.
 * - Nếu chưa set, fallback: brand active đầu tiên (theo id).
 * - Trả null nếu không có brand active nào.
 */
export async function getDefaultBrand() {
  const setting = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "defaultBrandId"),
  });
  const settingId = setting?.value ? parseInt(setting.value, 10) : null;
  if (settingId && Number.isFinite(settingId)) {
    const brand = await db.query.shuttlecockBrands.findFirst({
      where: and(
        eq(shuttlecockBrands.id, settingId),
        eq(shuttlecockBrands.isActive, true),
      ),
    });
    if (brand) return brand;
  }
  const fallback = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.isActive, true),
  });
  return fallback ?? null;
}

export async function setDefaultBrand(brandId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const exists = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, brandId),
  });
  if (!exists) {
    const t = await getTranslations("serverErrors");
    return { error: t("brandNotExists") };
  }

  const value = String(brandId);
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "defaultBrandId"),
  });
  if (existing) {
    await db
      .update(appSettings)
      .set({ value })
      .where(eq(appSettings.key, "defaultBrandId"));
  } else {
    await db.insert(appSettings).values({ key: "defaultBrandId", value });
  }
  revalidatePath("/admin/shuttlecocks");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Các thứ trong tuần được auto-tạo buổi (cron + auto-create today).
 * Lưu dưới dạng comma-joined "1,3,5". 0=CN, 1=T2, …, 6=T7 (chuẩn JS getDay).
 * Default fallback Mon/Wed/Fri để giữ behavior cũ nếu chưa set.
 */
const DEFAULT_SESSION_DAYS = [1, 3, 5] as const;

export async function getSessionDaysOfWeek(): Promise<number[]> {
  const setting = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "sessionDaysOfWeek"),
  });
  if (!setting?.value) return [...DEFAULT_SESSION_DAYS];
  const parsed = setting.value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
  if (parsed.length === 0) return [...DEFAULT_SESSION_DAYS];
  return Array.from(new Set(parsed)).sort((a, b) => a - b);
}

export async function setSessionDaysOfWeek(days: number[]) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const valid = Array.from(
    new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)),
  ).sort((a, b) => a - b);
  if (valid.length === 0) return { error: "Phải chọn ít nhất 1 ngày" };

  const value = valid.join(",");
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "sessionDaysOfWeek"),
  });
  if (existing) {
    await db
      .update(appSettings)
      .set({ value })
      .where(eq(appSettings.key, "sessionDaysOfWeek"));
  } else {
    await db.insert(appSettings).values({ key: "sessionDaysOfWeek", value });
  }
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/court-rent");
  return { success: true };
}

export async function updateAppName(name: string) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const trimmed = name.trim();
  if (!trimmed) {
    const t = await getTranslations("serverErrors");
    return { error: t("emptyName") };
  }

  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "appName"),
  });

  if (existing) {
    await db
      .update(appSettings)
      .set({ value: trimmed })
      .where(eq(appSettings.key, "appName"));
  } else {
    await db.insert(appSettings).values({ key: "appName", value: trimmed });
  }

  revalidatePath("/");
  revalidatePath("/admin");
  return { success: true };
}

/**
 * Đọc toàn bộ setting trong MỘT query. Không kiểm quyền admin vì trang công
 * khai cũng cần vài ngưỡng (ví dụ mức nợ chặn vote). Không trả về gì nhạy cảm.
 */
export async function getSettings(): Promise<AppSettings> {
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings);
  return resolveGlobal(rows);
}

/**
 * Ghi một setting. Upsert nguyên tử để hai request cùng lúc không đè nhau
 * (kiểu tìm trước rồi mới insert có kẽ hở giữa hai câu lệnh). Validate qua
 * schema của registry trước khi ghi; sai schema thì không ghi gì.
 */
export async function updateSetting<K extends SettingKey>(
  key: K,
  value: AppSettings[K],
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const def = SETTINGS[key];
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Giá trị không hợp lệ" };
  }

  const serialized = serializeSetting(key, parsed.data as AppSettings[K]);
  await db
    .insert(appSettings)
    .values({ key: def.key, value: serialized })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: serialized },
    });

  for (const path of def.revalidate) revalidatePath(path);
  return { success: true };
}
