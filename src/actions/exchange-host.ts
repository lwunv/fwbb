"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import type { Tx } from "@/db/tx";
import {
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  venues,
} from "@/db/schema";
import { requireApprovedMember } from "@/lib/member-auth";
import { depositSettlement } from "@/lib/exchange-fee";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";
import { MAX_SLOTS } from "@/lib/exchange/constants";
import {
  exchangeGate,
  loadHostedEvent,
  type ExchangeEventRow,
} from "@/lib/exchange/guards";
import {
  toPublicExchangeEvent,
  type PublicExchangeEvent,
} from "@/lib/exchange/public-event";
import { runSerial } from "@/lib/exchange/serial";
import { settleEvent, syncEventStatus } from "@/lib/exchange/settle";
import { notifyRegistrationDecision } from "@/lib/notifications/exchange-events";
import { isNotificationsEnabled } from "@/lib/notifications/notify";

// Chỉ export action tự kiểm quyền: host luôn là member của phiên, không bao
// giờ là trường trong input. Mọi lỗi "không phải buổi của bạn" dùng chung một
// thông báo để không lộ buổi/đăng ký của người khác có tồn tại hay không.

type Result<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { error: string };

type HostTx = {
  t: Awaited<ReturnType<typeof getTranslations>>;
  tx: Tx;
  now: Date;
  nowIso: string;
  notifyOn: boolean;
  hostId: number;
};

const idSchema = z.number().int().positive();
const decideSchema = z.object({
  registrationId: idSchema,
  decision: z.enum(["approve", "reject"]),
});
const depositSchema = z.object({
  registrationId: idSchema,
  received: z.boolean(),
});
const slotsSchema = z.object({
  eventId: idSchema,
  slotsTotal: z.number().int().min(1).max(MAX_SLOTS),
});
const eventOnlySchema = z.object({ eventId: idSchema });
const regOnlySchema = z.object({ registrationId: idSchema });
const unblockSchema = z.object({ blockId: idSchema });

/**
 * Khung chung của action ghi: cờ, quyền, zod, rồi một transaction. `run` chỉ
 * chạy khi mọi bước trước đều qua; `updateTag` chỉ sau khi commit thành công.
 */
async function hostAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  tag: string,
  run: (h: HostTx, data: z.infer<S>) => Promise<Result<T>>,
): Promise<Result<T>> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;

  const auth = await requireApprovedMember();
  if ("error" in auth) return { error: auth.error };
  const hostId = auth.member.id;

  const t = await getTranslations("exchange.errors");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };

  let outcome: Result<T>;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx) => {
        const now = new Date();
        const notifyOn = await isNotificationsEnabled(tx);
        return run(
          { t, tx, now, nowIso: now.toISOString(), notifyOn, hostId },
          parsed.data,
        );
      }),
    );
  } catch {
    console.error("[Exchange] host", { action: tag, hostId });
    return { error: t("saveFailed") };
  }
  if ("success" in outcome) updateTag("exchange");
  return outcome;
}

/** Đăng ký của buổi do host này mở; không phải của host thì `null`. */
async function loadHostedReg(h: HostTx, registrationId: number) {
  const [row] = await h.tx
    .select({ eventId: exchangeRegistrations.eventId })
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.id, registrationId))
    .limit(1);
  if (!row) return null;
  const ev = await loadHostedEvent(h.tx, row.eventId, h.hostId);
  if (!ev) return null;
  return { ev };
}

async function readReg(h: HostTx, id: number) {
  const [r] = await h.tx
    .select()
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.id, id))
    .limit(1);
  return r;
}

const isOpen = (ev: Pick<ExchangeEventRow, "status">) =>
  ev.status === "open" || ev.status === "full";

/**
 * Duyệt hoặc từ chối một đăng ký. Duyệt chỉ từ `pending` (có cọc thì phải
 * `depositPaid`). Từ chối từ `pending`, hoặc từ `approved` khi buổi chưa chốt
 * phí; người đã cọc nhận tin có `refundDue`.
 */
export async function decideRegistration(input: unknown): Promise<Result> {
  return hostAction(decideSchema, input, "decide", async (h, f) => {
    const { t, tx, now, nowIso, notifyOn } = h;
    const hosted = await loadHostedReg(h, f.registrationId);
    if (!hosted) return { error: t("notAllowed") };
    const ev = hosted.ev;
    if (ev.status === "done" || ev.status === "cancelled")
      return { error: t("eventClosed") };

    await settleEvent(tx, ev.id, now, notifyOn);
    const reg = await readReg(h, f.registrationId);
    if (!reg) return { error: t("notAllowed") };

    if (f.decision === "approve") {
      if (reg.status !== "pending" || !isOpen(ev))
        return { error: t("cannotDecide") };
      if (ev.depositAmount > 0 && !reg.depositPaid)
        return { error: t("depositRequired") };
      await tx
        .update(exchangeRegistrations)
        .set({ status: "approved", decidedAt: nowIso, updatedAt: nowIso })
        .where(eq(exchangeRegistrations.id, reg.id));
      await notifyRegistrationDecision(
        tx,
        {
          event: ev,
          reg: { id: reg.id, memberId: reg.memberId },
          decision: "approved",
          now,
        },
        notifyOn,
      );
      return { success: true };
    }

    // Pending bị từ chối được cả khi đã chốt phí (chưa tính phí); approved thì
    // chỉ trước khi chốt.
    const canReject =
      reg.status === "pending" || (reg.status === "approved" && isOpen(ev));
    if (!canReject) return { error: t("cannotDecide") };

    await tx
      .update(exchangeRegistrations)
      .set({
        status: "rejected",
        waitlistPos: null,
        decidedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(exchangeRegistrations.id, reg.id));
    // Chưa chốt phí (feeAmount null): cọc đã nhận phải hoàn đủ.
    const { refundDue } = depositSettlement(
      { depositPaid: reg.depositPaid, feeAmount: null },
      ev.depositAmount,
    );
    await notifyRegistrationDecision(
      tx,
      {
        event: ev,
        reg: { id: reg.id, memberId: reg.memberId },
        decision: "rejected",
        refundDue,
        now,
      },
      notifyOn,
    );
    // Slot vừa trống: đẩy danh sách chờ trong cùng giao dịch.
    await settleEvent(tx, ev.id, now, notifyOn);
    return { success: true };
  });
}

/**
 * Host xác nhận đã nhận (hoặc thu hồi) tiền cọc. `received: true` duyệt luôn
 * trong cùng bước; gọi lại khi đã duyệt là no-op nên không gửi tin hai lần.
 */
export async function setDepositReceived(input: unknown): Promise<Result> {
  return hostAction(depositSchema, input, "deposit", async (h, f) => {
    const { t, tx, now, nowIso, notifyOn } = h;
    const hosted = await loadHostedReg(h, f.registrationId);
    if (!hosted) return { error: t("notAllowed") };
    const ev = hosted.ev;
    if (ev.depositAmount <= 0 || !isOpen(ev))
      return { error: t("cannotDecide") };

    await settleEvent(tx, ev.id, now, notifyOn);
    const reg = await readReg(h, f.registrationId);
    if (!reg) return { error: t("notAllowed") };

    if (f.received) {
      if (reg.status === "approved" && reg.depositPaid)
        return { success: true };
      if (reg.status !== "pending") return { error: t("cannotDecide") };
      await tx
        .update(exchangeRegistrations)
        .set({
          depositPaid: true,
          depositPaidAt: nowIso,
          status: "approved",
          decidedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(exchangeRegistrations.id, reg.id));
      await notifyRegistrationDecision(
        tx,
        {
          event: ev,
          reg: { id: reg.id, memberId: reg.memberId },
          decision: "approved",
          now,
        },
        notifyOn,
      );
      return { success: true };
    }

    if (reg.status !== "pending") return { error: t("cannotDecide") };
    await tx
      .update(exchangeRegistrations)
      .set({ depositPaid: false, depositPaidAt: null, updatedAt: nowIso })
      .where(eq(exchangeRegistrations.id, reg.id));
    return { success: true };
  });
}

/** Tăng tổng slot (không giảm), rồi đẩy danh sách chờ vào chỗ mới. */
export async function increaseSlots(input: unknown): Promise<Result> {
  return hostAction(slotsSchema, input, "slots", async (h, f) => {
    const { t, tx, now, nowIso, notifyOn, hostId } = h;
    const ev = await loadHostedEvent(tx, f.eventId, hostId);
    if (!ev) return { error: t("notAllowed") };
    if (!isOpen(ev)) return { error: t("eventClosed") };
    if (f.slotsTotal <= ev.slotsTotal || f.slotsTotal > MAX_SLOTS)
      return { error: t("invalidSlots") };

    await settleEvent(tx, ev.id, now, notifyOn);
    await tx
      .update(exchangeEvents)
      .set({ slotsTotal: f.slotsTotal, updatedAt: nowIso })
      .where(eq(exchangeEvents.id, ev.id));
    const { status } = await settleEvent(tx, ev.id, now, notifyOn);
    // settleEvent bỏ qua buổi quá giờ/ẩn: vẫn phải chốt open/full theo slot mới.
    if (status === null)
      await syncEventStatus(tx, { ...ev, slotsTotal: f.slotsTotal }, now);
    return { success: true };
  });
}

/** Nút "Xét danh sách chờ": chỉ chạy `settleEvent`. */
export async function settleWaitlist(
  input: unknown,
): Promise<Result<{ promoted: number }>> {
  return hostAction(eventOnlySchema, input, "settle", async (h, f) => {
    const { t, tx, now, notifyOn, hostId } = h;
    const ev = await loadHostedEvent(tx, f.eventId, hostId);
    if (!ev) return { error: t("notAllowed") };
    const { promoted } = await settleEvent(tx, ev.id, now, notifyOn);
    return { success: true, data: { promoted: promoted.length } };
  });
}

/**
 * Chặn người đăng ký này khỏi mọi buổi sau của host. Không đổi đăng ký đang
 * có; chặn lại người đã bị chặn là no-op.
 */
export async function blockRegistrant(input: unknown): Promise<Result> {
  return hostAction(regOnlySchema, input, "block", async (h, f) => {
    const { t, tx, now, nowIso, notifyOn, hostId } = h;
    const hosted = await loadHostedReg(h, f.registrationId);
    if (!hosted) return { error: t("notAllowed") };
    await settleEvent(tx, hosted.ev.id, now, notifyOn);
    const reg = await readReg(h, f.registrationId);
    if (!reg || reg.memberId === hostId) return { error: t("notAllowed") };
    await tx
      .insert(hostBlocks)
      .values({
        hostMemberId: hostId,
        blockedMemberId: reg.memberId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();
    return { success: true };
  });
}

/** Gỡ chặn. Xoá theo `id` VÀ `host_member_id` nên không gỡ được dòng của host khác (I12). */
export async function unblockMember(input: unknown): Promise<Result> {
  return hostAction(unblockSchema, input, "unblock", async (h, f) => {
    const removed = await h.tx
      .delete(hostBlocks)
      .where(
        and(
          eq(hostBlocks.id, f.blockId),
          eq(hostBlocks.hostMemberId, h.hostId),
        ),
      )
      .returning({ id: hostBlocks.id });
    if (removed.length === 0) return { error: h.t("notAllowed") };
    return { success: true };
  });
}

export type ManageReg = {
  id: number;
  status: string;
  name: string;
  avatarUrl: string | null;
  avatarKey: string | null;
  gender: string | null;
  skillLevel: SkillLevel | null;
  skillOutOfRange: boolean;
  isNewAccount: boolean;
  accountLocked: boolean;
  maleCount: number;
  femaleCount: number;
  note: string | null;
  waitlistPos: number | null;
  depositPaid: boolean;
  feeAmount: number | null;
  feeWaived: boolean;
  paid: boolean;
  paidAmount: number | null;
  refundDue: number;
  remaining: number;
  checkedIn: boolean;
  createdAt: string;
};

export type ManageView = {
  event: PublicExchangeEvent;
  regs: ManageReg[];
  blocks: { id: number; name: string }[];
  /** True only when the event has a female reserve and its release time has passed. */
  reserveOpened: boolean;
};

function outOfRange(
  level: SkillLevel | null,
  min: SkillLevel | null,
  max: SkillLevel | null,
): boolean {
  if (!level) return false;
  const i = SKILL_LEVELS.indexOf(level);
  if (min && i < SKILL_LEVELS.indexOf(min)) return true;
  if (max && i > SKILL_LEVELS.indexOf(max)) return true;
  return false;
}

/**
 * Màn quản lý của host. Chỉ host của buổi thấy; người khác, chưa đăng nhập hoặc
 * cờ tắt đều nhận `null`. Không có sđt/email của ai.
 */
export async function getManageView(code: string): Promise<ManageView | null> {
  const gate = await exchangeGate();
  if ("error" in gate) return null;
  const auth = await requireApprovedMember();
  if ("error" in auth) return null;
  const host = auth.member;
  if (typeof code !== "string" || code.length === 0 || code.length > 64)
    return null;

  const [row] = await db
    .select({ event: exchangeEvents, venue: venues })
    .from(exchangeEvents)
    .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
    .where(
      and(
        eq(exchangeEvents.publicCode, code),
        eq(exchangeEvents.hostMemberId, host.id),
      ),
    )
    .limit(1);
  if (!row) return null;
  const ev = row.event;

  const regRows = await db
    .select({
      reg: exchangeRegistrations,
      name: members.name,
      avatarUrl: members.avatarUrl,
      avatarKey: members.avatarKey,
      gender: members.gender,
      skillLevel: members.skillLevel,
      isActive: members.isActive,
      approvalStatus: members.approvalStatus,
    })
    .from(exchangeRegistrations)
    .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
    .where(eq(exchangeRegistrations.eventId, ev.id))
    .orderBy(asc(exchangeRegistrations.id));

  // Cùng định nghĩa nick mới với `newAccountLimits` (nhóm approved không bao
  // giờ là nick mới, còn lại cần ít nhất 1 check-in), nhưng gom một truy vấn.
  const unapproved = regRows
    .filter((r) => r.approvalStatus !== "approved")
    .map((r) => r.reg.memberId);
  const attended = new Set<number>();
  if (unapproved.length > 0) {
    const rows = await db
      .select({ memberId: exchangeRegistrations.memberId })
      .from(exchangeRegistrations)
      .where(
        and(
          inArray(exchangeRegistrations.memberId, unapproved),
          eq(exchangeRegistrations.checkedIn, true),
        ),
      )
      .groupBy(exchangeRegistrations.memberId);
    for (const r of rows) attended.add(r.memberId);
  }

  const blockRows = await db
    .select({ id: hostBlocks.id, name: members.name })
    .from(hostBlocks)
    .innerJoin(members, eq(members.id, hostBlocks.blockedMemberId))
    .where(eq(hostBlocks.hostMemberId, host.id))
    .orderBy(asc(hostBlocks.id));

  const now = new Date();
  const regs: ManageReg[] = regRows.map((r) => {
    const { remaining, refundDue } = depositSettlement(r.reg, ev.depositAmount);
    const level = (r.skillLevel ?? null) as SkillLevel | null;
    return {
      id: r.reg.id,
      status: r.reg.status,
      name: r.name,
      avatarUrl: r.avatarUrl ?? null,
      avatarKey: r.avatarKey ?? null,
      gender: r.gender ?? null,
      skillLevel: level,
      skillOutOfRange: outOfRange(
        level,
        ev.skillMin ?? null,
        ev.skillMax ?? null,
      ),
      isNewAccount:
        r.approvalStatus !== "approved" && !attended.has(r.reg.memberId),
      accountLocked: !r.isActive || r.approvalStatus === "rejected",
      maleCount: r.reg.maleCount,
      femaleCount: r.reg.femaleCount,
      note: r.reg.note ?? null,
      waitlistPos: r.reg.waitlistPos,
      depositPaid: r.reg.depositPaid,
      feeAmount: r.reg.feeAmount,
      feeWaived: r.reg.feeWaived,
      paid: r.reg.paid,
      paidAmount: r.reg.paidAmount,
      refundDue,
      remaining,
      checkedIn: r.reg.checkedIn,
      createdAt: r.reg.createdAt,
    };
  });

  return {
    event: toPublicExchangeEvent({
      event: ev,
      venue: row.venue,
      host: {
        name: host.name,
        avatarUrl: host.avatarUrl ?? null,
        avatarKey: host.avatarKey ?? null,
      },
      regs: regs.map((r) => ({
        id: r.id,
        status: r.status,
        maleCount: r.maleCount,
        femaleCount: r.femaleCount,
        waitlistPos: r.waitlistPos,
        feeWaived: r.feeWaived,
      })),
      attendeeAvatars: [],
      now,
    }),
    regs,
    blocks: blockRows,
    reserveOpened:
      ev.femaleReservedSlots > 0 &&
      ev.reserveReleaseAt !== null &&
      new Date(ev.reserveReleaseAt).getTime() <= now.getTime(),
  };
}
