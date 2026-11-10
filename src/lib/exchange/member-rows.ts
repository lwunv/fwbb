import "server-only";
import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  abuseReports,
  exchangeCommentReads,
  exchangeCommentVotes,
  exchangeComments,
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  hostFeedback,
  hostFlagReviews,
  members,
  peerFeedback,
  referrals,
  venueReviews,
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
  checkedIn: boolean;
  checkedInAt: string | null;
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
    // Không phải tiền, nhưng cùng chỗ gộp: người đó đã có mặt nếu một trong
    // hai tài khoản được điểm danh; giờ điểm danh lấy lần sớm hơn (I4).
    checkedIn: target.checkedIn || source.checkedIn,
    checkedInAt:
      target.checkedIn || source.checkedIn
        ? earliest(
            target.checkedIn ? target.checkedInAt : null,
            source.checkedIn ? source.checkedInAt : null,
          )
        : target.checkedInAt,
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
  checkedIn: exchangeRegistrations.checkedIn,
  checkedInAt: exchangeRegistrations.checkedInAt,
};

/** Mốc lớn hơn trong hai (ISO UTC so được bằng chuỗi), null nhỏ hơn mọi giá trị. */
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Dời mọi dòng giao lưu của member nguồn sang member đích khi gộp tài khoản.
 * Gọi trong tx của merge, TRƯỚC khi xoá nguồn (FK bật thật). Không đụng sổ
 * quỹ hay công nợ: chỉ bảng giao lưu và uy tín. Tiền giao lưu (cọc, đã trả) đi theo
 * dòng đăng ký và được cộng sang dòng giữ lại khi trùng.
 *
 * Mọi trường hợp trùng khoá unique đều giữ dòng của đích, xoá dòng của nguồn.
 *
 * Trả `droppedRatedIds`: người được chấm mất dòng chấm vì buổi đó nay do đích
 * làm host. Sau commit không còn dòng nào nối họ với đích, nên người gọi phải
 * truyền họ vào `invalidateMemberReputation` (`rated`) để hồ sơ không cũ.
 */
export async function repointExchangeRows(
  tx: Tx,
  sourceId: number,
  targetId: number,
): Promise<{ droppedRatedIds: number[] }> {
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

  await repointCommentRows(tx, sourceId, targetId);
  const droppedRatedIds = await repointReputationRows(tx, sourceId, targetId);
  return { droppedRatedIds };
}

/**
 * Lượt chấm, đánh giá sân, cờ host, giới thiệu và mã hồ sơ (G2d, quyết định
 * 37). Trùng thì giữ dòng của đích. Sau khi gộp không còn lượt tự chấm mình
 * hay host chấm (hoặc được chấm ở) buổi của chính mình, kể cả dòng vốn của
 * đích. `member_ip_signals` không dời: xoá theo cascade cùng member nguồn.
 */
async function repointReputationRows(
  tx: Tx,
  sourceId: number,
  targetId: number,
): Promise<number[]> {
  const now = new Date().toISOString();
  const hostedByTarget = sql`(SELECT he.id FROM exchange_events he WHERE he.host_member_id = ${targetId})`;

  // peer_feedback: bỏ cặp sẽ thành tự chấm, bỏ dòng nguồn trùng khoá với
  // dòng đích, rồi dời hai chiều.
  await tx
    .delete(peerFeedback)
    .where(
      or(
        and(
          eq(peerFeedback.fromMemberId, sourceId),
          eq(peerFeedback.toMemberId, targetId),
        ),
        and(
          eq(peerFeedback.fromMemberId, targetId),
          eq(peerFeedback.toMemberId, sourceId),
        ),
      ),
    );
  await tx
    .delete(peerFeedback)
    .where(
      and(
        eq(peerFeedback.fromMemberId, sourceId),
        sql`EXISTS (SELECT 1 FROM peer_feedback k WHERE k.event_id = peer_feedback.event_id AND k.from_member_id = ${targetId} AND k.to_member_id = peer_feedback.to_member_id)`,
      ),
    );
  await tx
    .delete(peerFeedback)
    .where(
      and(
        eq(peerFeedback.toMemberId, sourceId),
        sql`EXISTS (SELECT 1 FROM peer_feedback k WHERE k.event_id = peer_feedback.event_id AND k.to_member_id = ${targetId} AND k.from_member_id = peer_feedback.from_member_id)`,
      ),
    );
  await tx
    .update(peerFeedback)
    .set({ fromMemberId: targetId })
    .where(eq(peerFeedback.fromMemberId, sourceId));
  await tx
    .update(peerFeedback)
    .set({ toMemberId: targetId })
    .where(eq(peerFeedback.toMemberId, sourceId));
  // Đọc trước khi xoá: người đích (gồm cả dòng vừa dời từ nguồn) đã chấm ở
  // buổi nay do đích làm host. Dòng chấm đích thì đích đã nằm trong danh sách
  // làm mới của người gọi.
  const droppedRated = await tx
    .selectDistinct({ id: peerFeedback.toMemberId })
    .from(peerFeedback)
    .where(
      and(
        eq(peerFeedback.fromMemberId, targetId),
        sql`${peerFeedback.eventId} IN ${hostedByTarget}`,
      ),
    );
  await tx
    .delete(peerFeedback)
    .where(
      and(
        or(
          eq(peerFeedback.fromMemberId, targetId),
          eq(peerFeedback.toMemberId, targetId),
        ),
        sql`${peerFeedback.eventId} IN ${hostedByTarget}`,
      ),
    );

  // host_feedback: một người một phiếu mỗi buổi, giữ của đích; rồi bỏ mọi
  // phiếu đích chấm buổi mà giờ chính đích là host.
  await tx
    .delete(hostFeedback)
    .where(
      and(
        eq(hostFeedback.fromMemberId, sourceId),
        sql`EXISTS (SELECT 1 FROM host_feedback k WHERE k.event_id = host_feedback.event_id AND k.from_member_id = ${targetId})`,
      ),
    );
  await tx
    .update(hostFeedback)
    .set({ fromMemberId: targetId })
    .where(eq(hostFeedback.fromMemberId, sourceId));
  await tx
    .delete(hostFeedback)
    .where(
      and(
        eq(hostFeedback.fromMemberId, targetId),
        sql`${hostFeedback.eventId} IN ${hostedByTarget}`,
      ),
    );

  // venue_reviews: một người một đánh giá mỗi sân. Đánh giá bị bỏ thì báo cáo
  // đang mở nhắm vào nó không còn gì để xử lý: đóng lại.
  const sourceReviews = await tx
    .select({ id: venueReviews.id, venueId: venueReviews.venueId })
    .from(venueReviews)
    .where(eq(venueReviews.memberId, sourceId));
  if (sourceReviews.length > 0) {
    const targetVenues = new Set(
      (
        await tx
          .select({ venueId: venueReviews.venueId })
          .from(venueReviews)
          .where(eq(venueReviews.memberId, targetId))
      ).map((r) => r.venueId),
    );
    for (const r of sourceReviews) {
      if (!targetVenues.has(r.venueId)) {
        await tx
          .update(venueReviews)
          .set({ memberId: targetId })
          .where(eq(venueReviews.id, r.id));
        continue;
      }
      await tx.delete(venueReviews).where(eq(venueReviews.id, r.id));
      await tx
        .update(abuseReports)
        .set({ status: "resolved", resolvedAt: now })
        .where(
          and(
            eq(abuseReports.targetType, "review"),
            eq(abuseReports.targetId, r.id),
            eq(abuseReports.status, "open"),
          ),
        );
    }
  }

  // host_flag_reviews: một dòng mỗi host; giữ số bị giữ lớn hơn và mốc xem
  // muộn hơn để cờ không bật lại sai.
  const [srcFlag] = await tx
    .select()
    .from(hostFlagReviews)
    .where(eq(hostFlagReviews.hostMemberId, sourceId));
  if (srcFlag) {
    const [tgtFlag] = await tx
      .select()
      .from(hostFlagReviews)
      .where(eq(hostFlagReviews.hostMemberId, targetId));
    if (tgtFlag) {
      await tx
        .update(hostFlagReviews)
        .set({
          captives: Math.max(tgtFlag.captives, srcFlag.captives),
          reviewedAt: latest(tgtFlag.reviewedAt, srcFlag.reviewedAt) ?? now,
        })
        .where(eq(hostFlagReviews.id, tgtFlag.id));
      await tx
        .delete(hostFlagReviews)
        .where(eq(hostFlagReviews.id, srcFlag.id));
    } else {
      await tx
        .update(hostFlagReviews)
        .set({ hostMemberId: targetId })
        .where(eq(hostFlagReviews.id, srcFlag.id));
    }
  }

  // referrals: mỗi người tối đa một người giới thiệu. Dòng nguồn được giới
  // thiệu bị bỏ nếu thành tự giới thiệu hoặc đích đã có người giới thiệu;
  // dòng nguồn giới thiệu chính đích cũng bỏ.
  const [asReferee] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.refereeMemberId, sourceId));
  if (asReferee) {
    const [targetHas] = await tx
      .select({ id: referrals.id })
      .from(referrals)
      .where(eq(referrals.refereeMemberId, targetId))
      .limit(1);
    if (asReferee.referrerMemberId === targetId || targetHas) {
      await tx.delete(referrals).where(eq(referrals.id, asReferee.id));
    } else {
      await tx
        .update(referrals)
        .set({ refereeMemberId: targetId })
        .where(eq(referrals.id, asReferee.id));
    }
  }
  await tx
    .delete(referrals)
    .where(
      and(
        eq(referrals.referrerMemberId, sourceId),
        eq(referrals.refereeMemberId, targetId),
      ),
    );
  await tx
    .update(referrals)
    .set({ referrerMemberId: targetId })
    .where(eq(referrals.referrerMemberId, sourceId));

  // Mã hồ sơ: đích chưa có thì nhận mã của nguồn (link cũ vẫn mở đúng người).
  // Nguồn nhả mã trước vì cột UNIQUE.
  const [src] = await tx
    .select({ code: members.publicCode })
    .from(members)
    .where(eq(members.id, sourceId));
  if (src?.code) {
    const [tgt] = await tx
      .select({ code: members.publicCode })
      .from(members)
      .where(eq(members.id, targetId));
    if (tgt && !tgt.code) {
      await tx
        .update(members)
        .set({ publicCode: null })
        .where(eq(members.id, sourceId));
      await tx
        .update(members)
        .set({ publicCode: src.code })
        .where(and(eq(members.id, targetId), isNull(members.publicCode)));
    }
  }
  return droppedRated.map((r) => r.id);
}

/**
 * Bình luận, phiếu và mốc đọc của giao lưu (G2c). Giữ bất biến
 * `upvotes` == số dòng phiếu của từng bình luận; không đụng sổ quỹ hay công nợ.
 */
async function repointCommentRows(
  tx: Tx,
  sourceId: number,
  targetId: number,
): Promise<void> {
  await tx
    .update(exchangeComments)
    .set({ authorMemberId: targetId })
    .where(eq(exchangeComments.authorMemberId, sourceId));
  await tx
    .update(exchangeComments)
    .set({ replyToMemberId: targetId })
    .where(eq(exchangeComments.replyToMemberId, sourceId));

  const dropVote = async (voteId: number, commentId: number) => {
    await tx
      .delete(exchangeCommentVotes)
      .where(eq(exchangeCommentVotes.id, voteId));
    await tx
      .update(exchangeComments)
      .set({ upvotes: sql`MAX(${exchangeComments.upvotes} - 1, 0)` })
      .where(eq(exchangeComments.id, commentId));
  };

  // Phiếu của nguồn: trùng phiếu đích thì bỏ, còn lại chuyển sang đích.
  const sourceVotes = await tx
    .select({
      id: exchangeCommentVotes.id,
      commentId: exchangeCommentVotes.commentId,
    })
    .from(exchangeCommentVotes)
    .where(eq(exchangeCommentVotes.memberId, sourceId));
  if (sourceVotes.length > 0) {
    const targetVoted = new Set(
      (
        await tx
          .select({ commentId: exchangeCommentVotes.commentId })
          .from(exchangeCommentVotes)
          .where(eq(exchangeCommentVotes.memberId, targetId))
      ).map((v) => v.commentId),
    );
    for (const v of sourceVotes) {
      if (targetVoted.has(v.commentId)) {
        await dropVote(v.id, v.commentId);
        continue;
      }
      await tx
        .update(exchangeCommentVotes)
        .set({ memberId: targetId })
        .where(eq(exchangeCommentVotes.id, v.id));
    }
  }

  // Phiếu thành tự bấm sau khi gộp (cả hai chiều): đích bấm cho bình luận
  // mà giờ chính đích là tác giả.
  const selfVotes = await tx
    .select({
      id: exchangeCommentVotes.id,
      commentId: exchangeCommentVotes.commentId,
    })
    .from(exchangeCommentVotes)
    .innerJoin(
      exchangeComments,
      eq(exchangeComments.id, exchangeCommentVotes.commentId),
    )
    .where(
      and(
        eq(exchangeCommentVotes.memberId, targetId),
        eq(exchangeComments.authorMemberId, targetId),
      ),
    );
  for (const v of selfVotes) await dropVote(v.id, v.commentId);

  // Mốc đọc: trùng (buổi, đích) thì dòng đích lấy mốc lớn hơn từng cột.
  const sourceReads = await tx
    .select()
    .from(exchangeCommentReads)
    .where(eq(exchangeCommentReads.memberId, sourceId));
  for (const r of sourceReads) {
    const [kept] = await tx
      .select()
      .from(exchangeCommentReads)
      .where(
        and(
          eq(exchangeCommentReads.eventId, r.eventId),
          eq(exchangeCommentReads.memberId, targetId),
        ),
      )
      .limit(1);
    if (kept) {
      await tx
        .update(exchangeCommentReads)
        .set({
          lastReadAt: latest(kept.lastReadAt, r.lastReadAt),
          lastReadGroupAt: latest(kept.lastReadGroupAt, r.lastReadGroupAt),
        })
        .where(eq(exchangeCommentReads.id, kept.id));
      await tx
        .delete(exchangeCommentReads)
        .where(eq(exchangeCommentReads.id, r.id));
    } else {
      await tx
        .update(exchangeCommentReads)
        .set({ memberId: targetId })
        .where(eq(exchangeCommentReads.id, r.id));
    }
  }
}

/** Tổng số dòng giao lưu còn trỏ tới member (12 bảng), dùng để chặn xoá cứng. */
export async function countExchangeRefs(
  db: DbOrTx,
  memberId: number,
): Promise<number> {
  const [[e], [r], [b], [a], [cm], [cv], [cr]] = await Promise.all([
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
    db
      .select({ n: count() })
      .from(exchangeComments)
      .where(
        or(
          eq(exchangeComments.authorMemberId, memberId),
          eq(exchangeComments.replyToMemberId, memberId),
        ),
      ),
    db
      .select({ n: count() })
      .from(exchangeCommentVotes)
      .where(eq(exchangeCommentVotes.memberId, memberId)),
    db
      .select({ n: count() })
      .from(exchangeCommentReads)
      .where(eq(exchangeCommentReads.memberId, memberId)),
  ]);
  // G2d (5 bảng): `member_ip_signals` không tính vì xoá theo cascade.
  const [[pf], [hf], [vr], [fl], [rf]] = await Promise.all([
    db
      .select({ n: count() })
      .from(peerFeedback)
      .where(
        or(
          eq(peerFeedback.fromMemberId, memberId),
          eq(peerFeedback.toMemberId, memberId),
        ),
      ),
    db
      .select({ n: count() })
      .from(hostFeedback)
      .where(eq(hostFeedback.fromMemberId, memberId)),
    db
      .select({ n: count() })
      .from(venueReviews)
      .where(eq(venueReviews.memberId, memberId)),
    db
      .select({ n: count() })
      .from(hostFlagReviews)
      .where(eq(hostFlagReviews.hostMemberId, memberId)),
    db
      .select({ n: count() })
      .from(referrals)
      .where(
        or(
          eq(referrals.referrerMemberId, memberId),
          eq(referrals.refereeMemberId, memberId),
        ),
      ),
  ]);
  return (
    Number(e.n) +
    Number(r.n) +
    Number(b.n) +
    Number(a.n) +
    Number(cm.n) +
    Number(cv.n) +
    Number(cr.n) +
    Number(pf.n) +
    Number(hf.n) +
    Number(vr.n) +
    Number(fl.n) +
    Number(rf.n)
  );
}
