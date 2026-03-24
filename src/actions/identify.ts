"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { identifySchema } from "@/lib/validators";
import { revalidatePath } from "next/cache";

export async function identifyUser(formData: FormData) {
  const parsed = identifySchema.safeParse({
    memberId: Number(formData.get("memberId")),
    phone: formData.get("phone") as string,
  });
  if (!parsed.success) return { error: "Thong tin khong hop le" };

  const member = await db.query.members.findFirst({
    where: and(
      eq(members.id, parsed.data.memberId),
      eq(members.phone, parsed.data.phone),
    ),
  });

  if (!member) return { error: "So dien thoai khong khop voi thanh vien" };

  if (!member.isActive) return { error: "Tai khoan da bi vo hieu hoa. Lien he admin." };

  await setUserCookie(member.id, member.phone);
  revalidatePath("/");
  return { success: true, memberName: member.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
