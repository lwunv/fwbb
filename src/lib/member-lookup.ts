import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";

/** Chuẩn hoá identifier để so khớp + làm khoá rate-limit ổn định. */
export function normalizeIdentifier(s: string): string {
  return s.trim().toLowerCase();
}

/** Chỉ chứa chữ số (+ vài ký tự phân cách) → coi như số điện thoại. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

type MemberRow = typeof members.$inferSelect;

/**
 * Tìm member theo 1 định danh bất kỳ cho login đa kênh: EMAIL → USERNAME →
 * PHONE, trả về match đầu tiên. Phone chỉ nhận khi khớp ĐÚNG 1 member (phone
 * không unique ở DB — nếu ≥2 người cùng sđt thì login-by-phone mơ hồ → bỏ).
 *
 * Trả null nếu không xác định được duy nhất 1 member — caller báo lỗi CHUNG
 * (không lộ định danh nào tồn tại).
 */
export async function findMemberByIdentifier(
  identifier: string,
): Promise<MemberRow | null> {
  const norm = normalizeIdentifier(identifier);
  if (!norm) return null;

  // 1. Email (lowercase, unique).
  if (norm.includes("@")) {
    const byEmail = await db.query.members.findFirst({
      where: eq(members.email, norm),
    });
    if (byEmail) return byEmail;
  }

  // 2. Username (lowercase, unique).
  const byUsername = await db.query.members.findFirst({
    where: eq(members.username, norm),
  });
  if (byUsername) return byUsername;

  // 3. Phone — chỉ nhận khi khớp đúng 1 (phone không unique).
  const digits = digitsOnly(identifier);
  if (digits.length >= 6) {
    const byPhone = await db.query.members.findMany({
      where: eq(members.phoneNumber, digits),
    });
    if (byPhone.length === 1) return byPhone[0];
  }

  return null;
}
