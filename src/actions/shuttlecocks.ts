"use server";

import { db } from "@/db";
import {
  shuttlecockBrands,
  sessionShuttlecocks,
  inventoryPurchases,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { brandSchema } from "@/lib/validators";
import { requireAdmin } from "@/lib/auth";
import { getTranslations } from "next-intl/server";

export async function getBrands() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  return db.query.shuttlecockBrands.findMany({
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

export async function getActiveBrands() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  return db.query.shuttlecockBrands.findMany({
    where: eq(shuttlecockBrands.isActive, true),
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

export async function createBrand(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = brandSchema.safeParse({
    name: formData.get("name") as string,
    pricePerTube: Number(formData.get("pricePerTube")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(shuttlecockBrands).values(parsed.data);
  revalidatePath("/admin/shuttlecocks");
  return { success: true };
}

export async function updateBrand(id: number, formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = brandSchema.safeParse({
    name: formData.get("name") as string,
    pricePerTube: Number(formData.get("pricePerTube")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(shuttlecockBrands)
    .set(parsed.data)
    .where(eq(shuttlecockBrands.id, id));
  revalidatePath("/admin/shuttlecocks");
  return { success: true };
}

export async function toggleBrandActive(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const brand = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, id),
  });
  if (!brand) return { error: "Khong tim thay hang cau" };
  await db
    .update(shuttlecockBrands)
    .set({ isActive: !brand.isActive })
    .where(eq(shuttlecockBrands.id, id));
  revalidatePath("/admin/shuttlecocks");
  return { success: true };
}

/**
 * Hard delete hãng cầu. Block nếu còn purchase hoặc usage tham chiếu — khi
 * đó admin nên dùng `toggleBrandActive` (vô hiệu hóa) để giữ lịch sử kho/giá.
 */
export async function deleteBrand(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  const brand = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, id),
  });
  if (!brand) return { error: t("brandNotFound") };

  const [{ usageCount }] = await db
    .select({ usageCount: sql<number>`count(*)` })
    .from(sessionShuttlecocks)
    .where(eq(sessionShuttlecocks.brandId, id));
  const [{ purchaseCount }] = await db
    .select({ purchaseCount: sql<number>`count(*)` })
    .from(inventoryPurchases)
    .where(eq(inventoryPurchases.brandId, id));
  const totalRefs = Number(usageCount) + Number(purchaseCount);
  if (totalRefs > 0) {
    return {
      error: t("brandInUse", {
        usageCount: Number(usageCount),
        purchaseCount: Number(purchaseCount),
      }),
    };
  }

  await db.delete(shuttlecockBrands).where(eq(shuttlecockBrands.id, id));
  revalidatePath("/admin/shuttlecocks");
  return { success: true };
}
