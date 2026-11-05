import "server-only";
import { and, count, eq, inArray, or } from "drizzle-orm";
import {
  abuseReports,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
} from "@/db/schema";
import type { DbOrTx, Tx } from "@/db/tx";

/**
 * Dời mọi dòng giao lưu của member nguồn sang member đích khi gộp tài khoản.
 * Gọi trong tx của merge, TRƯỚC khi xoá nguồn (FK bật thật). Không đụng tiền:
 * chỉ 4 bảng giao lưu, không ghi sổ quỹ hay công nợ.
 *
 * Mọi trường hợp trùng khoá unique đều giữ dòng của đích, xoá dòng của nguồn.
 */
export async function repointExchangeRows(
  tx: Tx,
  sourceId: number,
  targetId: number,
): Promise<void> {
  // Buổi do nguồn làm host.
  await tx
    .update(exchangeEvents)
    .set({ hostMemberId: targetId })
    .where(eq(exchangeEvents.hostMemberId, sourceId));

  // Đăng ký của nguồn.
  const sourceRegs = await tx
    .select({
      id: exchangeRegistrations.id,
      eventId: exchangeRegistrations.eventId,
      status: exchangeRegistrations.status,
    })
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.memberId, sourceId));

  if (sourceRegs.length > 0) {
    const eventIds = sourceRegs.map((r) => r.eventId);
    const targetRegs = await tx
      .select({ eventId: exchangeRegistrations.eventId })
      .from(exchangeRegistrations)
      .where(
        and(
          eq(exchangeRegistrations.memberId, targetId),
          inArray(exchangeRegistrations.eventId, eventIds),
        ),
      );
    const targetRegEvents = new Set(targetRegs.map((r) => r.eventId));
    const events = await tx
      .select({
        id: exchangeEvents.id,
        hostMemberId: exchangeEvents.hostMemberId,
      })
      .from(exchangeEvents)
      .where(inArray(exchangeEvents.id, eventIds));
    // hostMemberId đã được dời sang đích ở trên.
    const targetHostedEvents = new Set(
      events.filter((e) => e.hostMemberId === targetId).map((e) => e.id),
    );
    const now = new Date().toISOString();

    for (const reg of sourceRegs) {
      if (targetRegEvents.has(reg.eventId)) {
        await tx
          .delete(exchangeRegistrations)
          .where(eq(exchangeRegistrations.id, reg.id));
        continue;
      }
      const set: Partial<typeof exchangeRegistrations.$inferInsert> = {
        memberId: targetId,
      };
      // Host không tự đăng ký buổi của mình: giữ dòng làm lịch sử nhưng huỷ.
      if (targetHostedEvents.has(reg.eventId)) {
        set.status = "cancelled";
        set.cancelledAt = now;
        set.updatedAt = now;
        set.waitlistPos = null;
      }
      await tx
        .update(exchangeRegistrations)
        .set(set)
        .where(eq(exchangeRegistrations.id, reg.id));
    }
  }

  // Danh sách chặn: xoá dòng sẽ trùng cặp hoặc tự chặn mình, rồi chuyển phần còn lại.
  const blocks = await tx
    .select()
    .from(hostBlocks)
    .where(
      or(
        eq(hostBlocks.hostMemberId, sourceId),
        eq(hostBlocks.blockedMemberId, sourceId),
      ),
    );
  const existingPairs = new Set(
    (
      await tx
        .select({
          h: hostBlocks.hostMemberId,
          b: hostBlocks.blockedMemberId,
        })
        .from(hostBlocks)
        .where(
          or(
            eq(hostBlocks.hostMemberId, targetId),
            eq(hostBlocks.blockedMemberId, targetId),
          ),
        )
    ).map((r) => `${r.h}:${r.b}`),
  );
  for (const row of blocks) {
    const host = row.hostMemberId === sourceId ? targetId : row.hostMemberId;
    const blocked =
      row.blockedMemberId === sourceId ? targetId : row.blockedMemberId;
    const key = `${host}:${blocked}`;
    if (host === blocked || existingPairs.has(key)) {
      await tx.delete(hostBlocks).where(eq(hostBlocks.id, row.id));
      continue;
    }
    existingPairs.add(key);
    await tx
      .update(hostBlocks)
      .set({ hostMemberId: host, blockedMemberId: blocked })
      .where(eq(hostBlocks.id, row.id));
  }

  // Báo cáo vi phạm: người báo cáo, rồi đối tượng bị báo cáo là member nguồn.
  const reports = await tx
    .select({
      id: abuseReports.id,
      targetType: abuseReports.targetType,
      targetId: abuseReports.targetId,
    })
    .from(abuseReports)
    .where(eq(abuseReports.reporterMemberId, sourceId));
  const targetReports = await tx
    .select({
      t: abuseReports.targetType,
      i: abuseReports.targetId,
    })
    .from(abuseReports)
    .where(eq(abuseReports.reporterMemberId, targetId));
  const targetReportKeys = new Set(targetReports.map((r) => `${r.t}:${r.i}`));
  for (const r of reports) {
    // Báo cáo nhắm vào chính nguồn sẽ thành nhắm vào đích: đổi luôn để khỏi
    // lệch key so với dòng đích đã có.
    const newTargetId =
      r.targetType === "member" && r.targetId === sourceId
        ? targetId
        : r.targetId;
    const key = `${r.targetType}:${newTargetId}`;
    if (targetReportKeys.has(key)) {
      await tx.delete(abuseReports).where(eq(abuseReports.id, r.id));
      continue;
    }
    targetReportKeys.add(key);
    await tx
      .update(abuseReports)
      .set({ reporterMemberId: targetId, targetId: newTargetId })
      .where(eq(abuseReports.id, r.id));
  }
  // Báo cáo của người khác nhắm tới nguồn. Trùng unique (cùng người báo cáo
  // đã báo cả nguồn lẫn đích) thì xoá dòng nhắm nguồn.
  const aimed = await tx
    .select({
      id: abuseReports.id,
      reporter: abuseReports.reporterMemberId,
    })
    .from(abuseReports)
    .where(
      and(
        eq(abuseReports.targetType, "member"),
        eq(abuseReports.targetId, sourceId),
      ),
    );
  for (const r of aimed) {
    const dup = await tx
      .select({ id: abuseReports.id })
      .from(abuseReports)
      .where(
        and(
          eq(abuseReports.reporterMemberId, r.reporter),
          eq(abuseReports.targetType, "member"),
          eq(abuseReports.targetId, targetId),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      await tx.delete(abuseReports).where(eq(abuseReports.id, r.id));
    } else {
      await tx
        .update(abuseReports)
        .set({ targetId })
        .where(eq(abuseReports.id, r.id));
    }
  }
}

/** Tổng số dòng giao lưu còn trỏ tới member (4 bảng), dùng để chặn xoá cứng. */
export async function countExchangeRefs(
  db: DbOrTx,
  memberId: number,
): Promise<number> {
  const [[e], [r], [b], [a]] = await Promise.all([
    db
      .select({ n: count() })
      .from(exchangeEvents)
      .where(eq(exchangeEvents.hostMemberId, memberId)),
    db
      .select({ n: count() })
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.memberId, memberId)),
    db
      .select({ n: count() })
      .from(hostBlocks)
      .where(
        or(
          eq(hostBlocks.hostMemberId, memberId),
          eq(hostBlocks.blockedMemberId, memberId),
        ),
      ),
    db
      .select({ n: count() })
      .from(abuseReports)
      .where(eq(abuseReports.reporterMemberId, memberId)),
  ]);
  return Number(e.n) + Number(r.n) + Number(b.n) + Number(a.n);
}
