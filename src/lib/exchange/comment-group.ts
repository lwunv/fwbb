import "server-only";
import { and, eq } from "drizzle-orm";
import { exchangeRegistrations } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";

/** Member id của các đăng ký `approved` của buổi: người nhận tin ở khu Nhóm buổi. */
export async function groupMemberIdsOf(
  tx: DbOrTx,
  eventId: number,
): Promise<number[]> {
  const rows = await tx
    .select({ id: exchangeRegistrations.memberId })
    .from(exchangeRegistrations)
    .where(
      and(
        eq(exchangeRegistrations.eventId, eventId),
        eq(exchangeRegistrations.status, "approved"),
      ),
    );
  return rows.map((r) => r.id);
}
