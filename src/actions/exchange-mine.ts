"use server";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  exchangeEvents,
  exchangeRegistrations,
  hostBlocks,
  members,
  venues,
} from "@/db/schema";
import { requireExchangeMember } from "@/lib/member-auth";
import { registrationSettlement } from "@/lib/exchange-fee";
import { exchangeGate } from "@/lib/exchange/guards";
import { attachGroups, candidateColumns, toCard } from "@/lib/exchange/cards";
import {
  newCommentsSince,
  type NewCommentEvent,
} from "@/lib/exchange/comment-reads";
import type { ExchangeCard } from "@/lib/exchange/public-event";

const MINE_LIMIT = 50;

export type MyRegistration = ExchangeCard & {
  myStatus: string;
  feeAmount: number | null;
  paid: boolean;
  waitlistPos: number | null;
  /** Còn thiếu / cần hoàn, từ `registrationSettlement` (nguồn duy nhất, tính theo phần đã trả). */
  remaining: number;
  refundDue: number;
  /** Bình luận mới của người khác ở các khu mình đọc được, từ lần đọc trước. */
  newComments: number;
};

export type MyExchanges = {
  registrations: MyRegistration[];
  hosting: (ExchangeCard & { newComments: number })[];
  blocks: { id: number; name: string }[];
};

/**
 * Buổi giao lưu của chính người dùng: đăng ký, buổi mình mở, người mình chặn.
 * Tự kiểm quyền (cờ rồi phiên); người xem luôn suy ra từ cookie, không nhận id
 * từ client. Tài khoản giao lưu chưa vào nhóm cũng dùng được. Sắp diễn ra
 * trước (gần giờ nhất trước), đã qua xuống cuối, mỗi loại tối đa 50 dòng.
 */
export async function getMyExchanges(): Promise<
  MyExchanges | { error: string }
> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const me = auth.member.id;

  const now = new Date();
  const nowIso = now.toISOString();
  const upcomingFirst = [
    sql`CASE WHEN ${exchangeEvents.startAt} >= ${nowIso} THEN 0 ELSE 1 END`,
    sql`CASE WHEN ${exchangeEvents.startAt} >= ${nowIso} THEN ${exchangeEvents.startAt} END ASC`,
    sql`${exchangeEvents.startAt} DESC`,
  ] as const;

  const regRows = await db
    .select({
      ...candidateColumns,
      cancelledAt: exchangeEvents.cancelledAt,
      depositAmount: exchangeEvents.depositAmount,
      reg: exchangeRegistrations,
    })
    .from(exchangeRegistrations)
    .innerJoin(
      exchangeEvents,
      eq(exchangeEvents.id, exchangeRegistrations.eventId),
    )
    .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .where(eq(exchangeRegistrations.memberId, me))
    .orderBy(...upcomingFirst)
    .limit(MINE_LIMIT);

  const hostRows = await db
    .select({ ...candidateColumns, cancelledAt: exchangeEvents.cancelledAt })
    .from(exchangeEvents)
    .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .where(eq(exchangeEvents.hostMemberId, me))
    .orderBy(...upcomingFirst)
    .limit(MINE_LIMIT);

  const blockRows = await db
    .select({ id: hostBlocks.id, name: members.name })
    .from(hostBlocks)
    .innerJoin(members, eq(members.id, hostBlocks.blockedMemberId))
    .where(eq(hostBlocks.hostMemberId, me))
    .orderBy(asc(hostBlocks.id))
    .limit(MINE_LIMIT);

  const [regCandidates, hostCandidates] = await Promise.all([
    attachGroups(regRows),
    attachGroups(hostRows),
  ]);

  // Một truy vấn cho cả hai danh sách. Nhóm buổi chỉ tính khi là host hoặc `approved`.
  const events = new Map<number, NewCommentEvent>();
  for (const row of regRows)
    events.set(row.id, {
      id: row.id,
      groupAccess: row.reg.status === "approved",
      endAt: row.endAt,
      cancelledAt: row.cancelledAt,
    });
  for (const row of hostRows)
    events.set(row.id, {
      id: row.id,
      groupAccess: true,
      endAt: row.endAt,
      cancelledAt: row.cancelledAt,
    });
  const newComments = new Map(
    await newCommentsSince(db, me, [...events.values()], now),
  );

  const registrations = regRows.map((row, i): MyRegistration => {
    const s = registrationSettlement(row.reg, row.depositAmount, row.status);
    return {
      ...toCard(regCandidates[i], now, null),
      myStatus: row.reg.status,
      feeAmount: row.reg.feeAmount ?? null,
      paid: row.reg.paid,
      waitlistPos: row.reg.waitlistPos ?? null,
      remaining: s.remaining,
      refundDue: s.refundDue,
      newComments: newComments.get(row.id) ?? 0,
    };
  });

  return {
    registrations,
    hosting: hostCandidates.map((c, i) => ({
      ...toCard(c, now, null),
      newComments: newComments.get(hostRows[i].id) ?? 0,
    })),
    blocks: blockRows,
  };
}
