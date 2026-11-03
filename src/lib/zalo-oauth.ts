import { createHash, randomBytes } from "crypto";

const AUTHORIZE_URL = "https://oauth.zaloapp.com/v4/permission";
const TOKEN_URL = "https://oauth.zaloapp.com/v4/access_token";
const PROFILE_URL = "https://graph.zalo.me/v2.0/me?fields=id,name,picture";
const TIMEOUT_MS = 5000;
const FALLBACK_NAME = "Zalo user";
/** Zalo trả mã này khi IP người dùng không ở Việt Nam. */
const ERR_IP_NOT_IN_VN = -501;
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** base64url không padding của SHA-256(verifier), theo RFC 7636 (S256). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Verifier 43 ký tự [A-Za-z0-9] (đủ trong khoảng 43-128 của RFC 7636). */
export function createPkcePair(): { verifier: string; challenge: string } {
  // 62 ký tự: lấy byte < 248 (= 62 * 4) rồi % 62 để không lệch phân phối.
  let verifier = "";
  while (verifier.length < 43) {
    for (const b of randomBytes(64)) {
      if (b < 248 && verifier.length < 43) verifier += ALNUM[b % 62];
    }
  }
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function buildZaloAuthorizeUrl(p: {
  appId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    app_id: p.appId,
    redirect_uri: p.redirectUri,
    code_challenge: p.challenge,
    state: p.state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/**
 * Đổi `code` lấy access token. Không bao giờ ném lỗi và không đọc `expires_in`
 * (Zalo có thể trả chuỗi). Lỗi của Zalo đôi khi vẫn là HTTP 200, nên coi mọi
 * `error` khác rỗng hoặc thiếu `access_token` là thất bại.
 */
export async function exchangeZaloCode(
  p: { appId: string; secret: string; code: string; verifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string } | { error: "exchange" }> {
  try {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        secret_key: p.secret,
      },
      body: new URLSearchParams({
        code: p.code,
        app_id: p.appId,
        grant_type: "authorization_code",
        code_verifier: p.verifier,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { error: "exchange" };
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return { error: "exchange" };
    const o = body as Record<string, unknown>;
    if (hasError(o.error)) return { error: "exchange" };
    if (typeof o.access_token !== "string" || !o.access_token) {
      return { error: "exchange" };
    }
    return { accessToken: o.access_token };
  } catch {
    // Mạng, quá 5s hay body không phải JSON: đều không có token, không lộ chi tiết.
    return { error: "exchange" };
  }
}

function hasError(e: unknown): boolean {
  return e !== undefined && e !== null && e !== "" && e !== 0 && e !== "0";
}

/**
 * Lấy hồ sơ Zalo. `uid` luôn là chuỗi: id Zalo ~19 chữ số vượt 2^53 nên nếu
 * server trả số thì JSON.parse làm tròn mất chữ số, ta bọc nó thành chuỗi
 * trên text thô trước khi parse. Không bao giờ ném lỗi.
 */
export async function fetchZaloProfile(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | { uid: string; name: string; pictureUrl: string | null }
  | { error: "profile" | "region" }
> {
  try {
    const res = await fetchImpl(PROFILE_URL, {
      method: "GET",
      headers: { access_token: accessToken },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const quoted = text.replace(/("id"\s*:\s*)(-?\d+)(?=\s*[,}])/g, '$1"$2"');
    const body: unknown = JSON.parse(quoted);
    if (!body || typeof body !== "object") return { error: "profile" };
    const o = body as Record<string, unknown>;

    if (hasError(o.error)) {
      return Number(o.error) === ERR_IP_NOT_IN_VN
        ? { error: "region" }
        : { error: "profile" };
    }
    if (!res.ok) return { error: "profile" };

    const uid = typeof o.id === "string" ? o.id.trim() : "";
    if (!uid) return { error: "profile" };
    const name =
      typeof o.name === "string" && o.name.trim()
        ? o.name.trim()
        : FALLBACK_NAME;
    return { uid, name, pictureUrl: extractPictureUrl(o.picture) };
  } catch {
    return { error: "profile" };
  }
}

/** Chỉ nhận https: ảnh này sẽ được nhúng vào trang, không cho http/javascript/data. */
function extractPictureUrl(picture: unknown): string | null {
  if (!picture || typeof picture !== "object") return null;
  const data = (picture as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
