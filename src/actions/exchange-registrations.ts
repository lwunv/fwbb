"use server";

import { and, eq } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { exchangeEvents, exchangeRegistrations, members } from "@/db/schema";
import { requireExchangeMember } from "@/lib/member-auth";
import { newAccountLimits } from "@/lib/exchange/attendance";
import {
  MAX_COMPANIONS,
  NEW_ACCOUNT_MAX_WAITING,
  RL_REGISTER,
  TS_REGISTER,
} from "@/lib/exchange/constants";
import {
  activeHostWhere,
  checkBotAndRate,
  exchangeGate,
  isBlockedByHost,
} from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import {
  autoApproves,
  settleEvent,
  syncEventStatus,
} from "@/lib/exchange/settle";
import { fits, nextWaitlistPos, slotState } from "@/lib/exchange/slots";
import {
  notifyRegistrationCancelled,
  notifyRegistrationReceived,
} from "@/lib/notifications/exchange-events";
import { isNotificationsEnabled } from "@/lib/notifications/notify";

// Chỉ export action tự kiểm quyền: người thực hiện luôn lấy từ cookie phiên.

type RegisterStatus = "pending" | "approved" | "waitlist";
type RegisterResult =
  | {
      success: true;
      data: { status: RegisterStatus; waitlistPos: number | null };
    }
  | { error: string };

const MAX_HEADS = 1 + MAX_COMPANIONS;

const registerSchema = z
  .object({
    code: z.string().min(1).max(64),
    maleCount: z.number().int().min(0).max(MAX_HEADS),
    femaleCount: z.number().int().min(0).max(MAX_HEADS),
    note: z.string().max(300).optional(),
    turnstileToken: z.string().min(1).max(4096),
  })
  .refine(
    (v) =>
      v.maleCount + v.femaleCount >= 1 &&
      v.maleCount + v.femaleCount <= MAX_HEADS,
  );

const cancelSchema = z.object({ code: z.string().min(1).max(64) });

const HELD = ["pending", "approved", "waitlist"] as const;
const isHeld = (s: string): s is (typeof HELD)[number] =>
  (HELD as readonly string[]).includes(s);

function isUniqueViolation(e: unknown): boolean {
  const text = [e, (e as { cause?: unknown } | null)?.cause]
    .map((x) => (x instanceof Error ? x.message : String(x ?? "")))
    .join(" ");
  return /UNIQUE constraint failed/i.test(text);
}

export async function registerForExchange(
  input: unknown,
): Promise<RegisterResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_REGISTER,
    rateKey: `exchange-register:${member.id}`,
    limit: RL_REGISTER.limit,
    windowMs: RL_REGISTER.windowMs,
  });
  if ("error" in bot) return bot;

  const heads = f.maleCount + f.femaleCount;
  const note = f.note?.trim() || null;

  const run = () =>
    runSerial(() =>
      db.transaction(async (tx): Promise<RegisterResult> => {
        const now = new Date();
        const nowIso = now.toISOString();
        const notifyOn = await isNotificationsEnabled(tx);

        const [row] = await tx
          .select({ ev: exchangeEvents })
          .from(exchangeEvents)
          .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
          .where(and(eq(exchangeEvents.publicCode, f.code), activeHostWhere))
          .limit(1);
        const ev = row?.ev;
        if (
          !ev ||
          (ev.status !== "open" && ev.status !== "full") ||
          ev.hiddenAt !== null
        )
          return { error: t("eventClosed") };
        if (
          now.getTime() >= new Date(ev.registerDeadline).getTime() ||
          now.getTime() >= new Date(ev.startAt).getTime()
        )
          return { error: t("deadlinePassed") };

        // Một lỗi chung cho host và người bị chặn: không lộ ai chặn ai.
        if (ev.hostMemberId === member.id)
          return { error: t("cannotRegister") };
        if (await isBlockedByHost(tx, ev.hostMemberId, member.id))
          return { error: t("cannotRegister") };

        const [existing] = await tx
          .select()
          .from(exchangeRegistrations)
          .where(
            and(
              eq(exchangeRegistrations.eventId, ev.id),
              eq(exchangeRegistrations.memberId, member.id),
            ),
          )
          .limit(1);
        if (existing && isHeld(existing.status))
          return {
            success: true,
            data: {
              status: existing.status,
              waitlistPos: existing.waitlistPos,
            },
          };
        if (
          existing &&
          (existing.status === "rejected" || existing.status === "no_show")
        )
          return { error: t("cannotRegister") };
        // Huỷ muộn là khoản tính phí: cho đăng ký lại rồi huỷ thường sẽ xoá nó.
        if (existing?.status === "late_cancelled")
          return { error: t("lateCancelledNoRejoin") };

        if (heads > 1 && !ev.allowPlusOnes)
          return { error: t("cannotRegister") };
        const limits = await newAccountLimits(tx, member);
        if (limits.isNew) {
          if (heads > 1) return { error: t("cannotRegister") };
          if (limits.waitingCount >= NEW_ACCOUNT_MAX_WAITING)
            return {
              error: t("newAccountLimit", { max: NEW_ACCOUNT_MAX_WAITING }),
            };
        }

        // Người đang chờ lên trước người mới (I2).
        await settleEvent(tx, ev.id, now, notifyOn);

        const regs = await tx
          .select()
          .from(exchangeRegistrations)
          .where(eq(exchangeRegistrations.eventId, ev.id));
        const state = slotState(ev, regs, now);
        const seated = fits(state, f);
        const status: RegisterStatus = seated
          ? autoApproves(ev)
            ? "approved"
            : "pending"
          : "waitlist";
        const waitlistPos = seated ? null : nextWaitlistPos(regs);
        const fields = {
          status,
          maleCount: f.maleCount,
          femaleCount: f.femaleCount,
          note,
          waitlistPos,
          decidedAt: status === "approved" ? nowIso : null,
          cancelledAt: null,
          updatedAt: nowIso,
        };

        let regId: number;
        if (existing) {
          // Dùng lại dòng đã huỷ. Giữ nguyên dấu vết cọc: tiền cọc host đang
          // giữ không được mất theo một lần đăng ký lại.
          await tx
            .update(exchangeRegistrations)
            .set({
              ...fields,
              feeAmount: null,
              feeWaived: false,
              paid: false,
              paidAmount: null,
              paidAt: null,
              checkedIn: false,
              checkedInAt: null,
            })
            .where(eq(exchangeRegistrations.id, existing.id));
          regId = existing.id;
        } else {
          const [created] = await tx
            .insert(exchangeRegistrations)
            .values({
              eventId: ev.id,
              memberId: member.id,
              ...fields,
              createdAt: nowIso,
            })
            .returning({ id: exchangeRegistrations.id });
          regId = created.id;
        }

        await syncEventStatus(tx, ev, now);
        await notifyRegistrationReceived(
          tx,
          {
            event: ev,
            reg: {
              id: regId,
              maleCount: f.maleCount,
              femaleCount: f.femaleCount,
            },
            needsApproval: status === "pending",
            now,
          },
          notifyOn,
        );
        return { success: true, data: { status, waitlistPos } };
      }),
    );

  let outcome: RegisterResult;
  try {
    outcome = await run();
  } catch (e) {
    if (!isUniqueViolation(e)) {
      console.error("[Exchange] register", { memberId: member.id });
      return { error: t("saveFailed") };
    }
    // Hai lần gửi của cùng một member chạy đua: lần sau trả trạng thái lần trước.
    const [row] = await db
      .select({
        status: exchangeRegistrations.status,
        waitlistPos: exchangeRegistrations.waitlistPos,
      })
      .from(exchangeRegistrations)
      .innerJoin(
        exchangeEvents,
        eq(exchangeEvents.id, exchangeRegistrations.eventId),
      )
      .where(
        and(
          eq(exchangeEvents.publicCode, f.code),
          eq(exchangeRegistrations.memberId, member.id),
        ),
      )
      .limit(1);
    if (!row || !isHeld(row.status)) return { error: t("saveFailed") };
    return {
      success: true,
      data: { status: row.status, waitlistPos: row.waitlistPos },
    };
  }
  if ("success" in outcome) updateTag("exchange");
  return outcome;
}

export async function cancelMyRegistration(
  input: unknown,
): Promise<{ success: true } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const memberId = auth.member.id;

  const t = await getTranslations("exchange.errors");
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const code = parsed.data.code;

  try {
    const outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<{ ok: true } | { error: string }> => {
        const now = new Date();
        const nowIso = now.toISOString();
        const notifyOn = await isNotificationsEnabled(tx);

        const [ev] = await tx
          .select()
          .from(exchangeEvents)
          .where(eq(exchangeEvents.publicCode, code))
          .limit(1);
        if (!ev) return { error: t("notFound") };
        if (ev.status === "done" || ev.status === "cancelled")
          return { error: t("eventClosed") };

        const [reg] = await tx
          .select()
          .from(exchangeRegistrations)
          .where(
            and(
              eq(exchangeRegistrations.eventId, ev.id),
              eq(exchangeRegistrations.memberId, memberId),
            ),
          )
          .limit(1);
        if (!reg || !isHeld(reg.status)) return { error: t("notAllowed") };

        // Chỉ người đã được duyệt mới bị tính huỷ muộn; đang chờ thì huỷ thường.
        const late =
          reg.status === "approved" &&
          now.getTime() > new Date(ev.cancelDeadline).getTime();
        await tx
          .update(exchangeRegistrations)
          .set({
            status: late ? "late_cancelled" : "cancelled",
            waitlistPos: null,
            cancelledAt: nowIso,
            updatedAt: nowIso,
          })
          .where(eq(exchangeRegistrations.id, reg.id));

        // Người trong danh sách chờ huỷ thì host không có gì để xử lý.
        if (reg.status !== "waitlist")
          await notifyRegistrationCancelled(
            tx,
            {
              event: ev,
              reg,
              late,
              afterLock: ev.status === "locked",
              now,
            },
            notifyOn,
          );
        // Buổi đã chốt phí: không đẩy ai (settleEvent tự bỏ qua).
        await settleEvent(tx, ev.id, now, notifyOn);
        return { ok: true };
      }),
    );
    if ("error" in outcome) return outcome;
  } catch {
    console.error("[Exchange] cancel", { memberId });
    return { error: t("saveFailed") };
  }
  updateTag("exchange");
  return { success: true };
}
