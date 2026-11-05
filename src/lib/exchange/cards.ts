import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  exchangeEvents,
  exchangeRegistrations,
  members,
  venues,
} from "@/db/schema";
import type { SkillLevel } from "@/lib/skill-level";
import { HOLDING_STATUSES } from "@/lib/exchange/constants";
import {
  buildCounts,
  buildFeeDisplay,
  type ExchangeCard,
  type RegLike,
} from "@/lib/exchange/public-event";

/**
 * Dựng thẻ buổi giao lưu từ dòng truy vấn (dùng chung cho tìm kiếm và "Giao
 * lưu của tôi"). Không phải server action: chỉ import được từ server.
 */

export type Candidate = {
  code: string;
  title: string;
  startAt: string;
  endAt: string;
  status: ExchangeCard["status"];
  skillMin: SkillLevel | null;
  skillMax: SkillLevel | null;
  slotsTotal: number;
  femaleReservedSlots: number;
  reserveReleaseAt: string | null;
  feeMode: "fixed" | "fixed_gender" | "split_equal" | "split_female_discount";
  feeAmountMale: number | null;
  feeAmountFemale: number | null;
  feeFemalePercent: number | null;
  estimatedTotalCost: number | null;
  minHeads: number | null;
  hostHeads: number;
  venueId: number;
  venueName: string;
  venueLat: number;
  venueLng: number;
  venueAreaLabel: string | null;
  hostName: string;
  hostAvatarUrl: string | null;
  hostAvatarKey: string | null;
  /** Đầu người theo trạng thái: mảng thuần để đi qua JSON của cache. */
  groups: { status: string; male: number; female: number }[];
};

export const candidateColumns = {
  id: exchangeEvents.id,
  code: exchangeEvents.publicCode,
  title: exchangeEvents.title,
  startAt: exchangeEvents.startAt,
  endAt: exchangeEvents.endAt,
  status: exchangeEvents.status,
  skillMin: exchangeEvents.skillMin,
  skillMax: exchangeEvents.skillMax,
  slotsTotal: exchangeEvents.slotsTotal,
  femaleReservedSlots: exchangeEvents.femaleReservedSlots,
  reserveReleaseAt: exchangeEvents.reserveReleaseAt,
  feeMode: exchangeEvents.feeMode,
  feeAmountMale: exchangeEvents.feeAmountMale,
  feeAmountFemale: exchangeEvents.feeAmountFemale,
  feeFemalePercent: exchangeEvents.feeFemalePercent,
  estimatedTotalCost: exchangeEvents.estimatedTotalCost,
  minHeads: exchangeEvents.minHeads,
  hostHeads: exchangeEvents.hostHeads,
  venueId: venues.id,
  venueName: venues.name,
  venueLat: venues.lat,
  venueLng: venues.lng,
  venueAreaLabel: venues.areaLabel,
  hostName: members.name,
  hostAvatarUrl: members.avatarUrl,
  hostAvatarKey: members.avatarKey,
};

export type CandidateRow = Omit<Candidate, "groups"> & { id: number };

/** Gắn đầu người theo trạng thái bằng đúng 1 truy vấn GROUP BY cho cả lô. */
export async function attachGroups(rows: CandidateRow[]): Promise<Candidate[]> {
  if (rows.length === 0) return [];
  const grouped = await db
    .select({
      eventId: exchangeRegistrations.eventId,
      status: exchangeRegistrations.status,
      male: sql<number>`COALESCE(SUM(${exchangeRegistrations.maleCount}), 0)`,
      female: sql<number>`COALESCE(SUM(${exchangeRegistrations.femaleCount}), 0)`,
    })
    .from(exchangeRegistrations)
    .where(
      and(
        inArray(
          exchangeRegistrations.eventId,
          rows.map((r) => r.id),
        ),
        inArray(exchangeRegistrations.status, [
          ...HOLDING_STATUSES,
          "waitlist",
        ]),
      ),
    )
    .groupBy(exchangeRegistrations.eventId, exchangeRegistrations.status);
  const byEvent = new Map<number, Candidate["groups"]>();
  for (const g of grouped) {
    const list = byEvent.get(g.eventId) ?? [];
    list.push({
      status: g.status,
      male: Number(g.male),
      female: Number(g.female),
    });
    byEvent.set(g.eventId, list);
  }
  return rows.map(({ id, ...rest }) => ({
    ...rest,
    groups: byEvent.get(id) ?? [],
  }));
}

export function toCard(
  c: Candidate,
  now: Date,
  distanceM: number | null,
): ExchangeCard {
  const regs: RegLike[] = c.groups.map((g, i) => ({
    id: i,
    status: g.status,
    maleCount: g.male,
    femaleCount: g.female,
    waitlistPos: null,
    feeWaived: false,
  }));
  return {
    code: c.code,
    title: c.title,
    startAt: c.startAt,
    endAt: c.endAt,
    status: c.status,
    skillMin: c.skillMin,
    skillMax: c.skillMax,
    slotsTotal: c.slotsTotal,
    fee: buildFeeDisplay(c, regs),
    counts: buildCounts(c, regs, now),
    venue: {
      id: c.venueId,
      name: c.venueName,
      lat: c.venueLat,
      lng: c.venueLng,
      areaLabel: c.venueAreaLabel ?? null,
    },
    host: {
      name: c.hostName,
      avatarUrl: c.hostAvatarUrl ?? null,
      avatarKey: c.hostAvatarKey ?? null,
    },
    distanceM,
  };
}
