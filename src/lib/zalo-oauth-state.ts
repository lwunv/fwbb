import { createHmac, timingSafeEqual } from "crypto";

/** Cookie giữ state + PKCE verifier giữa lúc rời sang Zalo và lúc quay lại. */
export const ZALO_STATE_COOKIE = "fwbb-zalo-oauth";

/**
 * Path hẹp để cookie chỉ đi kèm request tới /api/auth/zalo/*. Xoá cookie phải
 * dùng đúng path này: `delete(name)` trần để Next tự điền `Path=/` nên không
 * xoá được cookie này.
 */
export const ZALO_STATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/zalo",
} as const;

export type ZaloOAuthState = {
  state: string;
  verifier: string;
  intent: "exchange";
  next: string;
  /** Epoch milliseconds lúc tạo. */
  iat: number;
};

const MAX_AGE_MS = 600 * 1000;
/** Cho phép đồng hồ lệch nhẹ; iat xa hơn mức này trong tương lai là bất thường. */
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const MAX_RAW_LENGTH = 4096;
// Tiền tố miền: chữ ký cookie fwbb-user (cùng khoá) không thể dùng lại ở đây.
const DOMAIN = "zalo-oauth:";

function secret(): string {
  const s = process.env.USER_COOKIE_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "USER_COOKIE_SECRET env var is required and must be at least 16 characters.",
    );
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

/** Dạng cookie: `base64url(json).chữ-ký-hex`. */
export function sealZaloState(s: ZaloOAuthState): string {
  const payload = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Trả null với mọi dạng sai: thiếu, sai chữ ký, sai shape, hết hạn. Không ném lỗi. */
export function openZaloState(
  raw: string | undefined,
  now: number = Date.now(),
): ZaloOAuthState | null {
  if (!raw || raw.length > MAX_RAW_LENGTH) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  try {
    if (!safeEqualHex(sig, sign(payload))) return null;
    const v: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (
      typeof o.state !== "string" ||
      !o.state ||
      typeof o.verifier !== "string" ||
      !o.verifier ||
      o.intent !== "exchange" ||
      typeof o.next !== "string" ||
      typeof o.iat !== "number" ||
      !Number.isFinite(o.iat)
    ) {
      return null;
    }
    if (o.iat > now + MAX_FUTURE_SKEW_MS) return null;
    if (now - o.iat > MAX_AGE_MS) return null;
    return {
      state: o.state,
      verifier: o.verifier,
      intent: "exchange",
      next: o.next,
      iat: o.iat,
    };
  } catch {
    return null;
  }
}

/** So `state` thời gian hằng; độ dài khác nhau thì false ngay (độ dài không bí mật). */
export function statesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
