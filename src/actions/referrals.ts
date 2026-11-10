"use server";

import { and, eq, sql } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { exchangeRegistrations, members, referrals } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { isLimitedNewAccount } from "@/lib/exchange/attendance";
import { checkBotAndRate, exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import { requireExchangeMember } from "@/lib/member-auth";
import { vnDate } from "@/lib/notifications/time";
import {
  REFERRAL_MONTHLY_LIMIT,
  RL_REFERRAL,
  TS_REFERRAL,
  repTag,
} from "@/lib/reputation/constants";
import { ensureMemberPublicCode } from "@/lib/reputation/member-code";
import { referrerState } from "@/lib/reputation/referral";
import { vnMonthBounds } from "@/lib/reputation/referral-rules";

// Chỉ export action tự kiểm quyền: người giới thiệu luôn lấy từ cookie phiên,
// input chỉ có mã hồ sơ của người được giới thiệu (quyết định 39). Thứ tự kiểm
// theo G2b quyết định 30: cờ, tài khoản, zod, Turnstile, rate limit, ghi DB.

type ReferResult = { success: true } | { error: string };

export type MyReferralState = {
  eligible: boolean;
  usedThisMonth: number;
  limit: number;
  blockedUntil: string | null;
  /** Chính người xem đang bị giới hạn nick mới (thẻ "Tài khoản mới bị giới hạn"). */
  limited: boolean;
};

const referSchema = z.object({
  // Mã hồ sơ `newPublicCode()` luôn 10 ký tự.
  code: z.string().length(10),
  turnstileToken: z.string().min(1).max(4096),
});

/** `dd/MM/yyyy` theo lịch Việt Nam, cho câu báo đang bị khoá. */
function vnDisplayDate(isoStr: string): string {
  const [y, m, d] = vnDate(new Date(isoStr)).split("-");
  return `${d}/${m}/${y}`;
}

/** Người giới thiệu hiện tại của nick có mã này, hoặc null. Chỉ đọc. */
async function referrerOfCode(
  dbx: DbOrTx,
  code: string,
): Promise<{ refereeId: number; referrerId: number } | null> {
  const [row] = await dbx
    .select({
      refereeId: referrals.refereeMemberId,
      referrerId: referrals.referrerMemberId,
    })
    .from(referrals)
    .innerJoin(members, eq(members.id, referrals.refereeMemberId))
    .where(eq(members.publicCode, code))
    .limit(1);
  return row ?? null;
}

type TxResult = { result: ReferResult; refereeId: number | null };

export async function referMember(input: unknown): Promise<ReferResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = referSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  // Gửi lại sau khi mất phản hồi: token Turnstile đã dùng, nên trả kết quả cũ
  // trước khi hỏi Cloudflare và không tốn lượt rate limit. Chỉ đọc.
  const prior = await referrerOfCode(db, f.code);
  if (prior && prior.referrerId === member.id) return { success: true };

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_REFERRAL,
    rateKey: `exchange-referral:${member.id}`,
    limit: RL_REFERRAL.limit,
    windowMs: RL_REFERRAL.windowMs,
  });
  if ("error" in bot) return bot;

  let out: TxResult;
  try {
    out = await runSerial(() =>
      db.transaction(async (tx): Promise<TxResult> => {
        const now = new Date();
        const fail = (error: string): TxResult => ({
          result: { error },
          refereeId: null,
        });

        const [target] = await tx
          .select({
            id: members.id,
            isActive: members.isActive,
            approvalStatus: members.approvalStatus,
          })
          .from(members)
          .where(eq(members.publicCode, f.code))
          .limit(1);
        if (
          !target ||
          target.id === member.id ||
          !target.isActive ||
          target.approvalStatus !== "pending"
        )
          return fail(t("referralTargetInvalid"));
        // Chỉ nick chưa được điểm danh lần nào (quyết định 42), kể cả ở buổi
        // đã ẩn: cùng định nghĩa nick mới của G2b.
        const [checkedIn] = await tx
          .select({ id: exchangeRegistrations.id })
          .from(exchangeRegistrations)
          .where(
            and(
              eq(exchangeRegistrations.memberId, target.id),
              eq(exchangeRegistrations.checkedIn, true),
            ),
          )
          .limit(1);
        if (checkedIn) return fail(t("referralTargetInvalid"));

        const taken = async (): Promise<TxResult | null> => {
          const [row] = await tx
            .select({ referrerId: referrals.referrerMemberId })
            .from(referrals)
            .where(eq(referrals.refereeMemberId, target.id))
            .limit(1);
          if (!row) return null;
          return row.referrerId === member.id
            ? { result: { success: true }, refereeId: target.id }
            : fail(t("referralTaken"));
        };
        const existing = await taken();
        if (existing) return existing;

        const state = await referrerState(tx, member, now);
        if (!state.eligible) return fail(t("referralNotEligible"));
        if (state.blockedUntil)
          return fail(
            t("referralBlocked", { date: vnDisplayDate(state.blockedUntil) }),
          );

        // Đếm và ghi trong CÙNG một câu lệnh (như `submitVenue`): tách đếm rồi
        // mới ghi thì nhiều lần gửi song song cùng thấy còn lượt. ON CONFLICT
        // giữ "mỗi nick chỉ được giới thiệu 1 lần" khi hai người giành nhau.
        const { from, to } = vnMonthBounds(now);
        const inserted = await tx.all<{ id: number }>(sql`
          INSERT INTO ${referrals} (referrer_member_id, referee_member_id, created_at)
          SELECT ${member.id}, ${target.id}, ${now.toISOString()}
          WHERE (
            SELECT count(*) FROM ${referrals}
            WHERE referrer_member_id = ${member.id}
              AND created_at >= ${from} AND created_at < ${to}
          ) < ${REFERRAL_MONTHLY_LIMIT}
          ON CONFLICT (referee_member_id) DO NOTHING
          RETURNING id
        `);
        if (inserted.length > 0)
          return { result: { success: true }, refereeId: target.id };
        return (
          (await taken()) ??
          fail(t("referralQuota", { max: REFERRAL_MONTHLY_LIMIT }))
        );
      }),
    );
  } catch {
    console.error("[Reputation] referral_failed", { memberId: member.id });
    return { error: t("referralSaveFailed") };
  }

  // Chip "Được giới thiệu" trên hồ sơ nằm trong cache uy tín của người đó.
  if (out.refereeId !== null) updateTag(repTag(out.refereeId));
  return out.result;
}

/**
 * Trạng thái giới thiệu của người đang đăng nhập (nút "Giới thiệu người này",
 * thẻ ở "Giao lưu của tôi"). `null` khi cờ tắt hoặc chưa đăng nhập. Chỉ đọc.
 */
export async function getMyReferralState(): Promise<MyReferralState | null> {
  const gate = await exchangeGate();
  if ("error" in gate) return null;
  const auth = await requireExchangeMember();
  if ("error" in auth) return null;
  const { member } = auth;
  const now = new Date();
  const state = await referrerState(db, member, now);
  return {
    eligible: state.eligible,
    usedThisMonth: state.usedThisMonth,
    limit: REFERRAL_MONTHLY_LIMIT,
    blockedUntil: state.blockedUntil,
    limited: await isLimitedNewAccount(db, member, now),
  };
}

/**
 * Mã hồ sơ của chính mình để chia sẻ (quyết định 50). Không Turnstile, không
 * rate limit (quyết định 47): chỉ ghi một lần khi cột còn trống.
 */
export async function ensureMyPublicCode(): Promise<
  { code: string } | { error: string }
> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;
  try {
    return { code: await ensureMemberPublicCode(db, member.id) };
  } catch {
    console.error("[Reputation] code_failed", { memberId: member.id });
    const t = await getTranslations("exchange.errors");
    return { error: t("profileCodeFailed") };
  }
}
