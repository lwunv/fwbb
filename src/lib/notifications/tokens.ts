import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { notificationPrefs } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import type { Recipient } from "./recipients";

const VERIFY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const MAX_RAW_LENGTH = 1024;
// Tiền tố miền: chữ ký các token khác dùng cùng khoá không dùng lại được ở đây.
const DOMAIN = "notify-verify:";

/** Thiếu khoá thì ném: người gọi đổi thành lỗi "không khả dụng", không có khoá dự phòng. */
function secret(): string {
  const s = process.env.USER_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error("USER_COOKIE_SECRET is required (min 16 chars)");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret())
    .update(DOMAIN + payload)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** sha256 hex của email đã chuẩn hoá (trim + lowercase). */
export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Token xác minh email: `base64url(json).chữ-ký-hex`. Link nằm trong log
 * request nên payload chỉ có id member và băm email, không có email đọc được.
 */
export function sealVerifyToken(
  memberId: number,
  email: string,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ mid: memberId, eh: emailHash(email), iat: now.getTime() }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Null với mọi dạng sai (thiếu khoá, sai chữ ký, sai shape, hết hạn). Không ném. */
export function openVerifyToken(
  raw: string,
  now: Date = new Date(),
): { mid: number; eh: string } | null {
  if (!raw || raw.length > MAX_RAW_LENGTH) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  try {
    if (!safeEqualHex(sig, sign(payload))) return null;
    const v: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o.mid !== "number" ||
      !Number.isInteger(o.mid) ||
      typeof o.eh !== "string" ||
      typeof o.iat !== "number" ||
      !Number.isFinite(o.iat)
    ) {
      return null;
    }
    const t = now.getTime();
    if (o.iat > t + MAX_FUTURE_SKEW_MS) return null;
    if (t - o.iat > VERIFY_MAX_AGE_MS) return null;
    return { mid: o.mid, eh: o.eh };
  } catch {
    return null;
  }
}

/** Token huỷ nhận email: chuỗi ngẫu nhiên, không chứa id (lưu ở notification_prefs). */
export function newUnsubToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Trả token huỷ nhận của người nhận, tạo khi chưa có. Upsert dòng prefs; token
 * đã có thì giữ nguyên (link cũ trong mail đã gửi vẫn dùng được).
 */
export async function ensureUnsubToken(
  db: DbOrTx,
  recipient: Recipient,
): Promise<string> {
  const now = new Date().toISOString();
  await db
    .insert(notificationPrefs)
    .values({
      recipientType: recipient.type,
      recipientId: recipient.id,
      unsubToken: newUnsubToken(),
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [notificationPrefs.recipientType, notificationPrefs.recipientId],
    });
  const where = and(
    eq(notificationPrefs.recipientType, recipient.type),
    eq(notificationPrefs.recipientId, recipient.id),
  );
  // Dòng có sẵn nhưng chưa có token: điền, không ghi đè token đang có.
  await db
    .update(notificationPrefs)
    .set({ unsubToken: newUnsubToken() })
    .where(and(where, isNull(notificationPrefs.unsubToken)));
  const [row] = await db
    .select({ token: notificationPrefs.unsubToken })
    .from(notificationPrefs)
    .where(where)
    .limit(1);
  if (!row?.token) throw new Error("unsub token missing");
  return row.token;
}
