import "server-only";
import { and, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { exchangeEvents, hostBlocks, members } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { getTrustedClientIp } from "@/lib/client-ip";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkRateLimit } from "@/lib/rate-limit";

export type ExchangeEventRow = typeof exchangeEvents.$inferSelect;
type GuardResult = { ok: true } | { error: string };

/** Dòng đầu của mọi action giao lưu: cờ tắt thì coi như tính năng không tồn tại. */
export async function exchangeGate(): Promise<GuardResult> {
  if (await isExchangeEnabled()) return { ok: true };
  const t = await getTranslations("exchange.errors");
  return { error: t("notFound") };
}

/**
 * Turnstile rồi rate limit. Rate limit ghi DB nên đứng sau captcha: request
 * chưa qua captcha không được ghi gì. Lý do của Cloudflare không lộ ra ngoài.
 */
export async function checkBotAndRate(opts: {
  token: string | null | undefined;
  action: string;
  rateKey: string;
  limit: number;
  windowMs: number;
}): Promise<GuardResult> {
  const t = await getTranslations("exchange.errors");

  // Fail-closed: thiếu/hỏng NEXT_PUBLIC_APP_URL thì không kiểm được hostname.
  let expectedHostname: string;
  try {
    expectedHostname = new URL(process.env.NEXT_PUBLIC_APP_URL as string)
      .hostname;
  } catch {
    console.error("[Exchange] config", { invalid: ["NEXT_PUBLIC_APP_URL"] });
    return { error: t("config") };
  }

  const ip = await getTrustedClientIp();
  const captcha = await verifyTurnstile(opts.token ?? null, {
    action: opts.action,
    remoteIp: ip !== "unknown" ? ip : undefined,
    expectedHostname,
  });
  if (!captcha.ok) {
    if (captcha.reason === "misconfigured") return { error: t("config") };
    return { error: t("captcha") };
  }

  const rl = await checkRateLimit(opts.rateKey, opts.limit, opts.windowMs);
  if (!rl.ok)
    return { error: t("rateLimited", { seconds: rl.retryAfter ?? 60 }) };
  return { ok: true };
}

/** Host còn hiệu lực (I14): đang hoạt động và đã được duyệt. Dùng với join `members`. */
export const activeHostWhere = and(
  eq(members.isActive, true),
  eq(members.approvalStatus, "approved"),
);

/** Buổi của chính member này; buổi của người khác hoặc không có thì `null`. */
export async function loadHostedEvent(
  tx: DbOrTx,
  eventId: number,
  memberId: number,
): Promise<ExchangeEventRow | null> {
  const [row] = await tx
    .select()
    .from(exchangeEvents)
    .where(
      and(
        eq(exchangeEvents.id, eventId),
        eq(exchangeEvents.hostMemberId, memberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function isBlockedByHost(
  tx: DbOrTx,
  hostMemberId: number,
  memberId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: hostBlocks.id })
    .from(hostBlocks)
    .where(
      and(
        eq(hostBlocks.hostMemberId, hostMemberId),
        eq(hostBlocks.blockedMemberId, memberId),
      ),
    )
    .limit(1);
  return !!row;
}
