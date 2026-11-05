import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { exchangeEvents, exchangeRegistrations } from "@/db/schema";
import type { Tx } from "@/db/tx";
import { registrationSettlement } from "@/lib/exchange-fee";
import { notifyEventCancelled } from "@/lib/notifications/exchange-events";
import type { ExchangeEventRow } from "./guards";

/**
 * Huỷ buổi: `open`/`full`/`locked` sang `cancelled`. Giữ nguyên trạng thái từng
 * đăng ký (không ghi đè lịch sử), chỉ báo người còn hiệu lực kèm số tiền họ
 * được hoàn: buổi huỷ nên không còn phí, hoàn đủ cọc, hoặc đủ số đã nhận nếu
 * host đã đánh dấu đã trả. Không ghi sổ tiền nào (tiền giao lưu ngoài sổ quỹ).
 *
 * Trả `false` khi buổi không còn ở trạng thái huỷ được (đã `done`/`cancelled`),
 * để gọi lặp không gửi tin lần hai. Caller lo quyền (host hoặc admin).
 */
export async function cancelEventCore(
  tx: Tx,
  event: ExchangeEventRow,
  now: Date,
  gate: boolean,
): Promise<boolean> {
  const nowIso = now.toISOString();
  const updated = await tx
    .update(exchangeEvents)
    .set({ status: "cancelled", cancelledAt: nowIso, updatedAt: nowIso })
    .where(
      and(
        eq(exchangeEvents.id, event.id),
        inArray(exchangeEvents.status, ["open", "full", "locked"]),
      ),
    )
    .returning({ id: exchangeEvents.id });
  if (updated.length === 0) return false;

  const regs = await tx
    .select()
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.eventId, event.id));
  await notifyEventCancelled(
    tx,
    {
      event,
      regs: regs.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        status: r.status,
        refundDue: registrationSettlement(r, event.depositAmount, "cancelled")
          .refundDue,
      })),
      now,
    },
    gate,
  );
  return true;
}
