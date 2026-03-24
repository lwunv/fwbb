"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setAdminCookie, clearAdminCookie } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/validators";

export async function login(
  _prevState: { error: string } | null,
  formData: FormData
) {
  const raw = {
    username: formData.get("username") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Vui long nhap day du thong tin" };
  }

  const admin = await db.query.admins.findFirst({
    where: eq(admins.username, parsed.data.username),
  });

  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.passwordHash))) {
    return { error: "Sai ten dang nhap hoac mat khau" };
  }

  await setAdminCookie(admin.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}
