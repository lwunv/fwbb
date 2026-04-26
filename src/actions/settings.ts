"use server";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";

export async function getAppName(): Promise<string> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "appName"),
  });
  return row?.value ?? "FWBB";
}

export async function updateAppName(name: string) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Tên không được để trống" };

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
