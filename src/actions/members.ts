"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { memberSchema } from "@/lib/validators";

export async function getMembers() {
  return db.query.members.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function getActiveMembers() {
  return db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function createMember(formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
    phone: formData.get("phone") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  await db.insert(members).values(parsed.data);
  revalidatePath("/admin/members");
  return { success: true };
}

export async function updateMember(id: number, formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
    phone: formData.get("phone") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  await db.update(members).set(parsed.data).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const member = await db.query.members.findFirst({ where: eq(members.id, id) });
  if (!member) return { error: "Khong tim thay thanh vien" };
  await db.update(members).set({ isActive: !member.isActive }).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}
