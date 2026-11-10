import "server-only";
import type { Tx } from "@/db/tx";
import { notify } from "./notify";
import { superadminRecipients } from "./recipients";

const hourUTC = (now: Date) => now.toISOString().slice(0, 13);

/**
 * Đánh giá sân vào hàng chờ: báo superadmin, tối đa 1 tin mỗi sân mỗi giờ
 * (khoá chống trùng theo giờ UTC). Payload chỉ có tên sân, không người viết,
 * không nội dung (quyết định 32). `gate` do action đọc sẵn trong transaction.
 */
export async function notifyVenueReviewHeld(
  tx: Tx,
  venue: { venueId: number; venueName: string },
  gate: boolean,
  now: Date,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: "venue_review_held",
    recipients: await superadminRecipients(tx),
    payload: { venueName: venue.venueName },
    dedupBase: `vrh:v${venue.venueId}:${hourUTC(now)}`,
    entity: { type: "venue", id: venue.venueId },
    now,
    gate,
  });
}
