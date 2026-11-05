import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { exchangeEvents, exchangeRegistrations, members } from "@/db/schema";
import type { Tx } from "@/db/tx";
import { notifyRegistrationDecision } from "@/lib/notifications/exchange-events";
import { activeHostWhere } from "./guards";
import { promoteFirstFit, slotState } from "./slots";

type EventRow = typeof exchangeEvents.$inferSelect;

/** Đăng ký tự duyệt chỉ khi buổi không thu cọc (R1): cọc cần host xác nhận. */
export const autoApproves = (
  ev: Pick<EventRow, "autoApprove" | "depositAmount">,
): boolean => ev.autoApprove && ev.depositAmount === 0;

async function loadRegs(tx: Tx, eventId: number) {
  return tx
    .select()
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.eventId, eventId));
}

/**
 * Đặt `open`/`full` theo số slot còn lại. Đọc lại trạng thái hiện tại trong
 * transaction thay vì tin bản đọc trước đó (caller có thể đã đổi nó), và chỉ
 * ghi khi buổi còn `open`/`full` và giá trị thực sự đổi.
 */
export async function syncEventStatus(
  tx: Tx,
  ev: EventRow,
  now: Date,
): Promise<"open" | "full"> {
  const state = slotState(ev, await loadRegs(tx, ev.id), now);
  const status = state.full ? "full" : "open";
  await tx
    .update(exchangeEvents)
    .set({ status, updatedAt: now.toISOString() })
    .where(
      and(
        eq(exchangeEvents.id, ev.id),
        inArray(exchangeEvents.status, ["open", "full"]),
        ne(exchangeEvents.status, status),
      ),
    );
  return status;
}

/**
 * Đẩy danh sách chờ rồi chốt `open`/`full`. Chỉ chạy khi buổi `open`/`full`,
 * chưa ẩn, host còn hiệu lực và chưa đến giờ bắt đầu (I11); ngoài ra không làm
 * gì. Chạy trong transaction của caller để việc huỷ/đăng ký và việc đẩy người
 * lên là một bước nguyên tử.
 */
export async function settleEvent(
  tx: Tx,
  eventId: number,
  now: Date,
  gate: boolean,
): Promise<{ promoted: number[]; status: "open" | "full" | null }> {
  const [row] = await tx
    .select({ ev: exchangeEvents })
    .from(exchangeEvents)
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .where(and(eq(exchangeEvents.id, eventId), activeHostWhere))
    .limit(1);
  const ev = row?.ev;
  if (
    !ev ||
    (ev.status !== "open" && ev.status !== "full") ||
    ev.hiddenAt !== null ||
    now.getTime() >= new Date(ev.startAt).getTime()
  )
    return { promoted: [], status: null };

  const regs = await loadRegs(tx, eventId);
  const promoted = promoteFirstFit(ev, regs, now);
  const status = autoApproves(ev) ? "approved" : "pending";
  for (const id of promoted) {
    const reg = regs.find((r) => r.id === id)!;
    await tx
      .update(exchangeRegistrations)
      .set({
        status,
        waitlistPos: null,
        decidedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(exchangeRegistrations.id, id));
    await notifyRegistrationDecision(
      tx,
      {
        event: ev,
        reg: { id, memberId: reg.memberId },
        decision: "promoted",
        status,
        now,
      },
      gate,
    );
  }
  return { promoted, status: await syncEventStatus(tx, ev, now) };
}
