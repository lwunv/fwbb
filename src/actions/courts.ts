"use server";

import { db } from "@/db";
import { courts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { courtSchema } from "@/lib/validators";

export async function getCourts() {
  return db.query.courts.findMany({
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

export async function getActiveCourts() {
  return db.query.courts.findMany({
    where: eq(courts.isActive, true),
    orderBy: (c, { asc }) => [asc(c.name)],
  });
}

export async function createCourt(formData: FormData) {
  const parsed = courtSchema.safeParse({
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || undefined,
    mapLink: (formData.get("mapLink") as string) || "",
    pricePerSession: Number(formData.get("pricePerSession")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.insert(courts).values({
    ...parsed.data,
    mapLink: parsed.data.mapLink || null,
  });
  revalidatePath("/admin/courts");
  return { success: true };
}

export async function updateCourt(id: number, formData: FormData) {
  const parsed = courtSchema.safeParse({
    name: formData.get("name") as string,
    address: (formData.get("address") as string) || undefined,
    mapLink: (formData.get("mapLink") as string) || "",
    pricePerSession: Number(formData.get("pricePerSession")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.update(courts).set({
    ...parsed.data,
    mapLink: parsed.data.mapLink || null,
  }).where(eq(courts.id, id));
  revalidatePath("/admin/courts");
  return { success: true };
}

export async function toggleCourtActive(id: number) {
  const court = await db.query.courts.findFirst({ where: eq(courts.id, id) });
  if (!court) return { error: "Khong tim thay san" };
  await db.update(courts).set({ isActive: !court.isActive }).where(eq(courts.id, id));
  revalidatePath("/admin/courts");
  return { success: true };
}
