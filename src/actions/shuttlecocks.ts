"use server";

import { db } from "@/db";
import { shuttlecockBrands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { brandSchema } from "@/lib/validators";

export async function getBrands() {
  return db.query.shuttlecockBrands.findMany({
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

export async function getActiveBrands() {
  return db.query.shuttlecockBrands.findMany({
    where: eq(shuttlecockBrands.isActive, true),
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}

export async function createBrand(formData: FormData) {
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
  const parsed = brandSchema.safeParse({
    name: formData.get("name") as string,
    pricePerTube: Number(formData.get("pricePerTube")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.update(shuttlecockBrands).set(parsed.data).where(eq(shuttlecockBrands.id, id));
  revalidatePath("/admin/shuttlecocks");
  return { success: true };
}

export async function toggleBrandActive(id: number) {
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
