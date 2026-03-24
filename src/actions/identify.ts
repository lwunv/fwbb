"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setUserCookie, clearUserCookie } from "@/lib/user-identity";
import { revalidatePath } from "next/cache";

export async function identifyUser(formData: FormData) {
  const memberId = Number(formData.get("memberId"));
  const phone = (formData.get("phone") as string) || "";

  if (!memberId || isNaN(memberId)) {
    return { error: "Vui lòng chọn tên của bạn" };
  }

  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });

  if (!member) return { error: "Không tìm thấy thành viên" };
  if (!member.isActive) return { error: "Tài khoản đã bị vô hiệu hóa. Liên hệ admin." };

  // If phone provided, update member's phone
  if (phone && phone.length >= 10) {
    await db.update(members).set({ phone }).where(eq(members.id, memberId));
  }

  await setUserCookie(member.id, member.phone);
  revalidatePath("/");
  return { success: true, memberName: member.name };
}

export async function resetIdentity() {
  await clearUserCookie();
  revalidatePath("/");
}
