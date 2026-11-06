import "server-only";
import { and, count, eq, inArray, or } from "drizzle-orm";
import {
  abuseReports,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
} from "@/db/schema";
import type { DbOrTx, Tx } from "@/db/tx";

type RegMoney = {
  depositPaid: boolean;
  depositPaidAt: string | null;
  paid: boolean;
  paidAmount: number | null;
  paidAt: string | null;
  refundedAmount: number | null;
  refundedAt: string | null;
};

/** Mốc sớm nhất trong hai (ISO UTC so được bằng chuỗi), bỏ qua null. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * Gộp tiền của hai đăng ký cùng một buổi (R24). Tiền host đã nhận từ cả hai
 * tài khoản phải còn trên dòng giữ lại, nếu không người đó mất quyền được hoàn.
 */
function mergeRegMoney(target: RegMoney, source: RegMoney): RegMoney {
  const paidAmount =
    target.paid && source.paid
      ? (target.paidAmount ?? 0) + (source.paidAmount ?? 0)
      : target.paid
        ? target.paidAmount
        : source.paid
          ? source.paidAmount
          : target.paidAmount;
  return {
    depositPaid: target.depositPaid || source.depositPaid,
    depositPaidAt: earliest(target.depositPaidAt, source.depositPaidAt),
    paid: target.paid || source.paid,
    paidAmount,
    paidAt: earliest(target.paidAt, source.paidAt),
    // Đã hoàn trên cả hai dòng đều là tiền đã trả lại thật: cộng dồn (R25).
    refundedAmount:
      target.refundedAmount === null && source.refundedAmount === null
        ? null
        : (target.refundedAmount ?? 0) + (source.refundedAmount ?? 0),
    refundedAt: earliest(target.refundedAt, source.refundedAt),
  };
}

const moneyCols = {
  depositPaid: exchangeRegistrations.depositPaid,
  depositPaidAt: exchangeRegistrations.depositPaidAt,
  paid: exchangeRegistrations.paid,
  paidAmount: exchangeRegistrations.paidAmount,
  paidAt: exchangeRegistrations.paidAt,
  refundedAmount: exchangeRegistrations.refundedAmount,
  refundedAt: exchangeRegistrations.refundedAt,
};

/**
 * Dời mọi dòng giao lưu của member nguồn sang member đích khi gộp tài khoản.
 * Gọi trong tx của merge, TRƯỚC khi xoá nguồn (FK bật thật). Không đụng sổ
 * quỹ hay công nợ: chỉ 4 bảng giao lưu. Tiền giao lưu (cọc, đã trả) đi theo
 * dòng đăng ký và được cộng sang dòng giữ lại khi trùng.
 *
 * Mọi trường hợp trùng khoá unique đều giữ dòng của đích, xoá dòng của nguồn.
 */
export async function repointExchangeRows(
  tx: Tx,
  sourceId: number,
  targetId: number,
): Promise<void> {
  const now = new Date().toISOString();

  // Buổi do nguồn làm host.
  const sourceHosted = await tx
    .update(exchangeEvents)
    .set({ hostMemberId: targetId })
    .where(eq(exchangeEvents.hostMemberId, sourceId))
    .returning({ id: exchangeEvents.id });

  // Host không tự đăng ký buổi của mình: đích đã đăng ký buổi nguồn làm host
  // thì giữ dòng làm lịch sử nhưng huỷ (ngược với trường hợp bên dưới).
  if (sourceHosted.length > 0) {
    await tx
      .update(exchangeRegistrations)
      .set({
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
        waitlistPos: null,
      })
      .where(
        and(
          eq(exchangeRegistrations.memberId, targetId),
          inArray(
            exchangeRegistrations.eventId,
            sourceHosted.map((e) => e.id),
          ),
        ),
      );
  }

  // Đăng ký của nguồn.
  const sourceRegs = await tx
    .select({
      id: exchangeRegistrations.id,
      eventId: exchangeRegistrations.eventId,
      status: exchangeRegistrations.status,
      ...moneyCols,
    })
    .from(exchangeRegistrations)
    .where(eq(exchangeRegistrations.memberId, sourceId));

  if (sourceRegs.length > 0) {
    const eventIds = sourceRegs.map((r) => r.eventId);
    const targetRegs = await tx
      .select({
        id: exchangeRegistrations.id,
        eventId: exchangeRegistrations.eventId,
        ...moneyCols,
      })
      .from(exchangeRegistrations)
      .where(
        and(
          eq(exchangeRegistrations.memberId, targetId),
          inArray(exchangeRegistrations.eventId, eventIds),
        ),
      );
    const targetRegByEvent = new Map(targetRegs.map((r) => [r.eventId, r]));
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
    for (const reg of sourceRegs) {
      const kept = targetRegByEvent.get(reg.eventId);
      if (kept) {
        // Chuyển tiền sang dòng giữ lại TRƯỚC khi xoá dòng nguồn.
        const merged = mergeRegMoney(kept, reg);
        await tx
          .update(exchangeRegistrations)
          .set({ ...merged, updatedAt: now })
          .where(eq(exchangeRegistrations.id, kept.id));
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
