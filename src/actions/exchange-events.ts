"use server";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { exchangeEvents, venues } from "@/db/schema";
import { requireApprovedMember } from "@/lib/member-auth";
import { exchangeFeeEstimate } from "@/lib/exchange-fee";
import {
  RL_OPEN,
  TS_OPEN,
  type ExchangeEventStatus,
} from "@/lib/exchange/constants";
import {
  eventFormSchema,
  hostContactSchema,
  payoutSchema,
  resolveEventTimes,
  zaloGroupLinkSchema,
} from "@/lib/exchange/event-schema";
import {
  checkBotAndRate,
  exchangeGate,
  loadHostedEvent,
} from "@/lib/exchange/guards";
import { newPublicCode } from "@/lib/exchange/public-code";
import { ensureMemberPublicCode } from "@/lib/reputation/member-code";

// Chỉ export action tự kiểm quyền: người thực hiện luôn lấy từ cookie phiên.

type Result<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { error: string };

const MAX_CODE_ATTEMPTS = 3;
const EDITABLE_STATUSES: readonly ExchangeEventStatus[] = ["open", "full"];

/** Cột nào vừa vi phạm unique, đọc từ thông điệp của libsql (có thể nằm ở `cause`). */
function uniqueConflict(e: unknown): "public_code" | "idempotency_key" | null {
  const text = [e, (e as { cause?: unknown } | null)?.cause]
    .map((x) => (x instanceof Error ? x.message : String(x ?? "")))
    .join(" ");
  if (!/UNIQUE constraint failed/i.test(text)) return null;
  if (text.includes("public_code")) return "public_code";
  if (text.includes("idempotency_key")) return "idempotency_key";
  return null;
}

export async function createExchangeEvent(
  input: unknown,
): Promise<Result<{ code: string }>> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };
  const memberId = auth.member.id;

  const t = await getTranslations("exchange.errors");
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_OPEN,
    rateKey: `exchange-open:${memberId}`,
    limit: RL_OPEN.limit,
    windowMs: RL_OPEN.windowMs,
  });
  if ("error" in bot) return bot;

  const times = resolveEventTimes(f, new Date());
  if ("error" in times) return { error: t(times.error) };

  // Mỗi cách phí lưu đúng các trường nó dùng, còn lại null. Cách `fixed` lưu số
  // duy nhất ở `feeAmountMale` (module phí đọc cột này cho cả hai giới).
  const fee = {
    feeMode: f.feeMode,
    feeAmountMale:
      f.feeMode === "fixed" || f.feeMode === "fixed_gender"
        ? f.feeAmountMale
        : null,
    feeAmountFemale:
      f.feeMode === "fixed_gender"
        ? f.feeAmountFemale
        : f.feeMode === "split_female_discount" &&
            f.feeFemalePercent === undefined
          ? (f.feeAmountFemale ?? null)
          : null,
    feeFemalePercent:
      f.feeMode === "split_female_discount"
        ? (f.feeFemalePercent ?? null)
        : null,
    estimatedTotalCost:
      f.feeMode === "split_equal" || f.feeMode === "split_female_discount"
        ? f.estimatedTotalCost
        : null,
    minHeads:
      f.feeMode === "split_equal" || f.feeMode === "split_female_discount"
        ? f.minHeads
        : null,
  };

  // Cọc không được vượt mức thấp nhất mà một người phải trả, nếu không người
  // đó đã đặt cọc nhiều hơn phí thật.
  const estimate = exchangeFeeEstimate({ ...fee, hostHeads: f.hostHeads });
  if (f.depositAmount > Math.min(estimate.male, estimate.female))
    return { error: t("depositTooHigh") };

  // Đã qua zod nên hoặc đủ cả ba, hoặc không có gì.
  const payout =
    f.payoutBankBin && f.payoutAccountNo && f.payoutAccountName
      ? {
          bankBin: f.payoutBankBin,
          accountNo: f.payoutAccountNo,
          accountName: f.payoutAccountName,
        }
      : null;
  const nowIso = new Date().toISOString();

  // Host cần mã hồ sơ để trang buổi dẫn tới hồ sơ của họ. Ghi ngoài transaction
  // của buổi: mã đã cấp thì giữ dù tạo buổi thất bại.
  try {
    await ensureMemberPublicCode(db, memberId);
  } catch {
    console.error("[Reputation] code_failed", { memberId });
    return { error: t("saveFailed") };
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const publicCode = newPublicCode();
    try {
      const outcome = await db.transaction(
        async (tx): Promise<{ code: string } | { error: string }> => {
          const [replay] = await tx
            .select({
              code: exchangeEvents.publicCode,
              host: exchangeEvents.hostMemberId,
            })
            .from(exchangeEvents)
            .where(eq(exchangeEvents.idempotencyKey, f.idempotencyKey))
            .limit(1);
          if (replay)
            return replay.host === memberId
              ? { code: replay.code }
              : { error: t("notAllowed") };

          const [venue] = await tx
            .select({ status: venues.status })
            .from(venues)
            .where(eq(venues.id, f.venueId))
            .limit(1);
          if (venue?.status !== "approved")
            return { error: t("venueUnavailable") };

          await tx.insert(exchangeEvents).values({
            publicCode,
            idempotencyKey: f.idempotencyKey,
            hostMemberId: memberId,
            venueId: f.venueId,
            title: f.title,
            description: f.description.trim() || null,
            startAt: times.startAt,
            endAt: times.endAt,
            skillMin: f.skillMin ?? null,
            skillMax: f.skillMax ?? null,
            slotsTotal: f.slotsTotal,
            femaleReservedSlots: f.femaleReservedSlots,
            reserveReleaseAt: times.reserveReleaseAt,
            hostHeads: f.hostHeads,
            shuttleType: f.shuttleType || null,
            ...fee,
            depositAmount: f.depositAmount,
            registerDeadline: times.registerDeadline,
            cancelDeadline: times.cancelDeadline,
            autoApprove: f.autoApprove,
            allowPlusOnes: f.allowPlusOnes,
            payoutBankBin: payout?.bankBin ?? null,
            payoutAccountNo: payout?.accountNo ?? null,
            payoutAccountName: payout?.accountName ?? null,
            hostContact: f.hostContact || null,
            zaloGroupLink: f.zaloGroupLink || null,
            status: "open",
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          return { code: publicCode };
        },
      );
      if (!("code" in outcome)) return { error: outcome.error };
      updateTag("exchange");
      return { success: true, data: { code: outcome.code } };
    } catch (e) {
      const which = uniqueConflict(e);
      if (which === "public_code") continue;
      if (which === "idempotency_key") {
        // Hai lần gửi cùng key chạy đua: lần thua trả mã của lần thắng.
        const [row] = await db
          .select({
            code: exchangeEvents.publicCode,
            host: exchangeEvents.hostMemberId,
          })
          .from(exchangeEvents)
          .where(eq(exchangeEvents.idempotencyKey, f.idempotencyKey))
          .limit(1);
        if (row && row.host === memberId)
          return { success: true, data: { code: row.code } };
      }
      console.error("[Exchange] create_failed", { memberId });
      return { error: t("saveFailed") };
    }
  }
  console.error("[Exchange] code_collision", { memberId });
  return { error: t("saveFailed") };
}

const updateSchema = z.object({
  eventId: z.number().int().positive(),
  title: z.string().trim().min(5).max(80).optional(),
  description: z.string().max(2000).optional(),
  shuttleType: z.string().trim().max(60).optional(),
  hostContact: hostContactSchema.optional(),
  zaloGroupLink: zaloGroupLinkSchema.optional(),
  payout: payoutSchema.nullable().optional(),
});

/**
 * Host sửa phần chữ và thông tin nhận tiền. Giờ, sân, cách phí, số tiền và
 * slot nữ không sửa được sau khi mở. Trường ngoài danh sách bị bỏ qua.
 */
export async function updateExchangeEvent(input: unknown): Promise<Result> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };

  const t = await getTranslations("exchange.errors");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const p = parsed.data;

  const patch: Partial<typeof exchangeEvents.$inferInsert> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.description !== undefined)
    patch.description = p.description.trim() || null;
  if (p.shuttleType !== undefined) patch.shuttleType = p.shuttleType || null;
  if (p.hostContact !== undefined) patch.hostContact = p.hostContact || null;
  if (p.zaloGroupLink !== undefined)
    patch.zaloGroupLink = p.zaloGroupLink || null;
  if (p.payout !== undefined) {
    patch.payoutBankBin = p.payout?.bankBin ?? null;
    patch.payoutAccountNo = p.payout?.accountNo ?? null;
    patch.payoutAccountName = p.payout?.accountName ?? null;
  }

  let result: { ok: true } | { error: string };
  try {
    result = await db.transaction(async (tx) => {
      const ev = await loadHostedEvent(tx, p.eventId, auth.member.id);
      if (!ev) return { error: t("notAllowed") };
      if (!EDITABLE_STATUSES.includes(ev.status))
        return { error: t("eventClosed") };
      if (Object.keys(patch).length === 0) return { ok: true as const };
      await tx
        .update(exchangeEvents)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(exchangeEvents.id, ev.id));
      return { ok: true as const };
    });
  } catch {
    console.error("[Exchange] update_failed", { eventId: p.eventId });
    return { error: t("saveFailed") };
  }
  if (!("ok" in result)) return { error: result.error };
  updateTag("exchange");
  return { success: true };
}

/** Tài khoản nhận tiền của buổi gần nhất, để form điền sẵn. */
export async function getMyLastPayout(): Promise<{
  bankBin: string;
  accountNo: string;
  accountName: string;
} | null> {
  const gate = await exchangeGate();
  if ("error" in gate) return null;
  const auth = await requireApprovedMember();
  if ("error" in auth) return null;

  const [row] = await db
    .select({
      bankBin: exchangeEvents.payoutBankBin,
      accountNo: exchangeEvents.payoutAccountNo,
      accountName: exchangeEvents.payoutAccountName,
    })
    .from(exchangeEvents)
    .where(
      and(
        eq(exchangeEvents.hostMemberId, auth.member.id),
        isNotNull(exchangeEvents.payoutBankBin),
        isNotNull(exchangeEvents.payoutAccountNo),
        isNotNull(exchangeEvents.payoutAccountName),
      ),
    )
    .orderBy(desc(exchangeEvents.id))
    .limit(1);
  if (!row?.bankBin || !row.accountNo || !row.accountName) return null;
  return {
    bankBin: row.bankBin,
    accountNo: row.accountNo,
    accountName: row.accountName,
  };
}
