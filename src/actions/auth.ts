"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setAdminCookie, clearAdminCookie, requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginSchema } from "@/lib/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";

async function getClientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

export async function login(
  _prevState: { error: string } | null,
  formData: FormData,
) {
  const raw = {
    username: formData.get("username") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Vui long nhap day du thong tin" };
  }

  // Rate-limit 2-tầng:
  // 1. Per (IP+username): 5 lần / 5 phút — chống guess password 1 user
  // 2. Per IP: 20 lần / 5 phút — chống enum username (mỗi username mới
  //    không reset bucket #1 → unbounded brute-force giữa nhiều username)
  const ip = await getClientIp();
  const rlIp = await checkRateLimit(`login-ip:${ip}`, 20, 5 * 60_000);
  if (!rlIp.ok) {
    return {
      error: `Quá nhiều lần đăng nhập, thử lại sau ${rlIp.retryAfter ?? 60}s`,
    };
  }
  const rl = await checkRateLimit(
    `login:${ip}:${parsed.data.username}`,
    5,
    5 * 60_000,
  );
  if (!rl.ok) {
    return {
      error: `Quá nhiều lần đăng nhập, thử lại sau ${rl.retryAfter ?? 60}s`,
    };
  }

  const admin = await db.query.admins.findFirst({
    where: eq(admins.username, parsed.data.username),
  });

  if (
    !admin ||
    !(await bcrypt.compare(parsed.data.password, admin.passwordHash))
  ) {
    return { error: "Sai ten dang nhap hoac mat khau" };
  }

  await setAdminCookie(admin.id);
  redirect("/admin/dashboard");
}

export async function logout() {
  await clearAdminCookie();
  redirect("/admin/login");
}

export async function changePassword(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  // Auth gate — Server Action có thể bị gọi qua RPC từ bất kỳ HTTP endpoint
  // nào, không chỉ từ admin form. Trước đây thiếu check này → ai cũng có
  // thể spam guess current password.
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  // Rate-limit per IP — bcrypt 12 round ~250ms/attempt, vẫn cần chặn online
  // brute-force ở quy mô lớn. Bucket 5 lần / 5 phút.
  const ip = await getClientIp();
  const rl = await checkRateLimit(`change-password:${ip}`, 5, 5 * 60_000);
  if (!rl.ok) {
    return {
      error: `Quá nhiều lần đổi mật khẩu, thử lại sau ${rl.retryAfter ?? 60}s`,
    };
  }

  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "Vui long nhap day du thong tin" };
  }

  if (newPassword.length < 6) {
    return { error: "Mat khau moi phai co it nhat 6 ky tu" };
  }

  if (newPassword !== confirmPassword) {
    return { error: "Mat khau moi khong khop" };
  }

  // Resolve admin id from cookie (auth.admin.sub) thay vì findFirst() —
  // findFirst giả định 1 admin duy nhất, sai khi có >1 admin trong DB.
  const adminIdNum = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminIdNum)) {
    return { error: "Phiên admin không hợp lệ, đăng nhập lại" };
  }
  const admin = await db.query.admins.findFirst({
    where: eq(admins.id, adminIdNum),
  });
  if (!admin) {
    return { error: "Khong tim thay tai khoan admin" };
  }

  const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!isValid) {
    return { error: "Mat khau hien tai khong dung" };
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(admins)
    .set({ passwordHash: newHash })
    .where(eq(admins.id, admin.id));

  return { success: true };
}
