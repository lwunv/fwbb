/**
 * Cloudflare Turnstile server-side verification.
 *
 * Fail-closed: anything other than a clean `success: true` from Cloudflare is a
 * rejection, and this function never throws. Callers only get a coarse reason;
 * Cloudflare's own error codes are deliberately not exposed to the user.
 */

export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare documents tokens as at most 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5000;

/**
 * Cloudflare's published dummy secrets (always pass / always fail / token
 * already spent). With these, siteverify answers with placeholder `action` and
 * `hostname`, so comparing them would fail for the wrong reason.
 */
const DUMMY_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export type TurnstileFailure =
  | "missing"
  | "invalid"
  | "unavailable"
  | "misconfigured";

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: TurnstileFailure };

export type TurnstileOptions = {
  /** Must equal the `action` the widget was rendered with. */
  action: string;
  /** Optional hint for Cloudflare; skipped when the IP is unknown. */
  remoteIp?: string;
  /** When set, the hostname Cloudflare saw must match. */
  expectedHostname?: string;
};

type SiteverifyBody = {
  success?: unknown;
  action?: unknown;
  hostname?: unknown;
};

const fail = (reason: TurnstileFailure): TurnstileResult => ({
  ok: false,
  reason,
});

/**
 * Verify a Turnstile token. Tokens are single-use and valid for 300s, so a
 * replayed token comes back as `success: false` (`timeout-or-duplicate`).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: TurnstileOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  try {
    const trimmed = typeof token === "string" ? token.trim() : "";
    if (!trimmed) return fail("missing");
    if (trimmed.length > MAX_TOKEN_LENGTH) return fail("invalid");

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      console.error("[Turnstile] misconfigured: TURNSTILE_SECRET_KEY");
      return fail("misconfigured");
    }

    const form = new URLSearchParams({ secret, response: trimmed });
    if (opts.remoteIp && opts.remoteIp !== "unknown") {
      form.set("remoteip", opts.remoteIp);
    }

    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[Turnstile] unavailable", { status: res.status });
      return fail("unavailable");
    }

    const data = (await res.json()) as SiteverifyBody | null;
    if (!data || typeof data !== "object") return fail("unavailable");
    if (data.success !== true) return fail("invalid");

    if (!DUMMY_SECRETS.has(secret)) {
      if (data.action !== opts.action) return fail("invalid");
      if (opts.expectedHostname && data.hostname !== opts.expectedHostname) {
        return fail("invalid");
      }
    }
    return { ok: true };
  } catch {
    // Network error, timeout (AbortSignal) or non-JSON body: Cloudflare could
    // not give us an answer, so the caller must reject the request.
    console.error("[Turnstile] unavailable");
    return fail("unavailable");
  }
}
