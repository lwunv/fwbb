import "server-only";
import { inArray, sql } from "drizzle-orm";
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
  /**
   * Đầu người bị tính ở lần chốt gần nhất (`feeAmount` có, không miễn): giá
   * khi đã chốt tính theo đây, cùng quy tắc R13 với trang buổi (R27).
   */
  charged: { male: number; female: number };
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

export type CandidateRow = Omit<Candidate, "groups" | "charged"> & {
  id: number;
};

const GROUPED_STATUSES = new Set<string>([...HOLDING_STATUSES, "waitlist"]);

/**
 * Gắn đầu người theo trạng thái và đầu người bị tính ở lần chốt gần nhất bằng
 * đúng 1 truy vấn GROUP BY cho cả lô. Không lọc trạng thái trong SQL vì người
 * huỷ muộn hay vắng mặt vẫn bị tính phí đã chốt.
 */
export async function attachGroups(rows: CandidateRow[]): Promise<Candidate[]> {
  if (rows.length === 0) return [];
  const isCharged = sql`(${exchangeRegistrations.feeAmount} IS NOT NULL AND ${exchangeRegistrations.feeWaived} = 0)`;
  const grouped = await db
    .select({
      eventId: exchangeRegistrations.eventId,
      status: exchangeRegistrations.status,
      male: sql<number>`COALESCE(SUM(${exchangeRegistrations.maleCount}), 0)`,
      female: sql<number>`COALESCE(SUM(${exchangeRegistrations.femaleCount}), 0)`,
      chargedMale: sql<number>`COALESCE(SUM(CASE WHEN ${isCharged} THEN ${exchangeRegistrations.maleCount} ELSE 0 END), 0)`,
      chargedFemale: sql<number>`COALESCE(SUM(CASE WHEN ${isCharged} THEN ${exchangeRegistrations.femaleCount} ELSE 0 END), 0)`,
    })
    .from(exchangeRegistrations)
    .where(
      inArray(
        exchangeRegistrations.eventId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(exchangeRegistrations.eventId, exchangeRegistrations.status);
  const byEvent = new Map<number, Candidate["groups"]>();
  const chargedBy = new Map<number, Candidate["charged"]>();
  for (const g of grouped) {
    const charged = chargedBy.get(g.eventId) ?? { male: 0, female: 0 };
    charged.male += Number(g.chargedMale);
    charged.female += Number(g.chargedFemale);
    chargedBy.set(g.eventId, charged);
    if (!GROUPED_STATUSES.has(g.status)) continue;
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
    charged: chargedBy.get(id) ?? { male: 0, female: 0 },
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
  // Đã chốt: một nhóm gộp đúng những người bị tính lần chốt gần nhất (R27).
  const lockedRegs: RegLike[] = [
    {
      id: 0,
      status: "approved",
      maleCount: c.charged.male,
      femaleCount: c.charged.female,
      waitlistPos: null,
      feeWaived: false,
      feeAmount: 0,
    },
  ];
  const locked = c.status === "locked" || c.status === "done";
  return {
    code: c.code,
    title: c.title,
    startAt: c.startAt,
    endAt: c.endAt,
    status: c.status,
    skillMin: c.skillMin,
    skillMax: c.skillMax,
    slotsTotal: c.slotsTotal,
    fee: buildFeeDisplay(c, locked ? lockedRegs : regs),
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
