"use server";

import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import {
  exchangeEvents,
  exchangeRegistrations,
  members,
  venues,
} from "@/db/schema";
import { getExchangeViewer } from "@/lib/member-auth";
import { boundingBox, haversineMeters, snapToGrid } from "@/lib/geo";
import { registrationSettlement } from "@/lib/exchange-fee";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";
import { sessionStartInstant } from "@/lib/notifications/time";
import { isRealDate } from "@/lib/exchange/event-schema";
import {
  CANDIDATE_LIMIT,
  GRID_MARGIN_M,
  LIST_LIMIT,
} from "@/lib/exchange/constants";
import {
  activeHostWhere,
  exchangeGate,
  isBlockedByHost,
} from "@/lib/exchange/guards";
import { newAccountLimits } from "@/lib/exchange/attendance";
import {
  toPublicExchangeEvent,
  vnTimeOfDay,
  type ExchangeCard,
  type PublicExchangeEvent,
  type RegLike,
} from "@/lib/exchange/public-event";
import {
  attachGroups,
  candidateColumns,
  toCard,
  type Candidate,
} from "@/lib/exchange/cards";

export type ViewerExtras = {
  role: "guest" | "member" | "host";
  myRegistration: {
    id: number;
    status: string;
    maleCount: number;
    femaleCount: number;
    feeAmount: number | null;
    feeWaived: boolean;
    depositPaid: boolean;
    paid: boolean;
    waitlistPos: number | null;
    remaining: number;
    refundDue: number;
  } | null;
  skillWarning: "below" | "above" | null;
  hostContact: string | null;
  zaloGroupLink: string | null;
  payout: {
    bankBin: string | null;
    accountNo: string | null;
    accountName: string | null;
  } | null;
  attendees:
    | { name: string; avatarUrl: string | null; avatarKey: string | null }[]
    | null;
  blocked: boolean;
  isNewAccount: boolean;
};

const OPEN_STATUSES = ["open", "full"] as const;
const AVATAR_LIMIT = 8;

// ---------------------------------------------------------------------------
// Một buổi
// ---------------------------------------------------------------------------

/**
 * Phần công khai của một buổi, có cache 60s. Chỉ chứa dữ liệu đã qua whitelist
 * cộng `hostMemberId` / `hostActive` để quyết định hiển thị; không có liên hệ,
 * link nhóm hay tài khoản nhận tiền. Trả JSON thuần.
 */
const getPublicEventCached = unstable_cache(
  async (code: string) => {
    const [row] = await db
      .select({
        event: exchangeEvents,
        venue: venues,
        hostName: members.name,
        hostAvatarUrl: members.avatarUrl,
        hostAvatarKey: members.avatarKey,
        hostActive: members.isActive,
        hostApproval: members.approvalStatus,
      })
      .from(exchangeEvents)
      .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
      .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
      .where(eq(exchangeEvents.publicCode, code))
      .limit(1);
    if (!row) return null;

    const regs: RegLike[] = await db
      .select({
        id: exchangeRegistrations.id,
        status: exchangeRegistrations.status,
        maleCount: exchangeRegistrations.maleCount,
        femaleCount: exchangeRegistrations.femaleCount,
        waitlistPos: exchangeRegistrations.waitlistPos,
        feeWaived: exchangeRegistrations.feeWaived,
        feeAmount: exchangeRegistrations.feeAmount,
      })
      .from(exchangeRegistrations)
      .where(eq(exchangeRegistrations.eventId, row.event.id));

    const avatars = await db
      .select({
        avatarUrl: members.avatarUrl,
        avatarKey: members.avatarKey,
      })
      .from(exchangeRegistrations)
      .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
      .where(
        and(
          eq(exchangeRegistrations.eventId, row.event.id),
          eq(exchangeRegistrations.status, "approved"),
        ),
      )
      .orderBy(asc(exchangeRegistrations.id))
      .limit(AVATAR_LIMIT);

    return {
      event: toPublicExchangeEvent({
        event: row.event,
        venue: row.venue,
        host: {
          name: row.hostName,
          avatarUrl: row.hostAvatarUrl,
          avatarKey: row.hostAvatarKey,
        },
        regs,
        attendeeAvatars: avatars,
        now: new Date(),
      }),
      eventId: row.event.id,
      hostMemberId: row.event.hostMemberId,
      hostActive: row.hostActive && row.hostApproval === "approved",
    };
  },
  ["exchange-event"],
  { revalidate: 60, tags: ["exchange"] },
);

function skillWarningFor(
  level: SkillLevel | null,
  min: SkillLevel | null,
  max: SkillLevel | null,
): "below" | "above" | null {
  if (!level) return null;
  const i = SKILL_LEVELS.indexOf(level);
  if (min && i < SKILL_LEVELS.indexOf(min)) return "below";
  if (max && i > SKILL_LEVELS.indexOf(max)) return "above";
  return null;
}

function guestExtras(): ViewerExtras {
  return {
    role: "guest",
    myRegistration: null,
    skillWarning: null,
    hostContact: null,
    zaloGroupLink: null,
    payout: null,
    attendees: null,
    blocked: false,
    isNewAccount: false,
  };
}

type PayoutCols = {
  payoutBankBin: string | null;
  payoutAccountNo: string | null;
  payoutAccountName: string | null;
};

/**
 * Tài khoản nhận tiền chỉ lộ khi người xem thật sự phải chuyển: đã có phí chốt
 * còn thiếu, hoặc đang chờ duyệt và buổi đòi cọc mà chưa cọc.
 */
function payoutFor(
  ev: PublicExchangeEvent,
  reg: typeof exchangeRegistrations.$inferSelect,
  priv: PayoutCols | undefined,
): ViewerExtras["payout"] {
  if (!priv) return null;
  const s = registrationSettlement(reg, ev.depositAmount, ev.status);
  const owesFee =
    (ev.status === "locked" || ev.status === "done") &&
    reg.feeAmount !== null &&
    reg.feeAmount > 0 &&
    s.remaining > 0;
  const owesDeposit =
    reg.status === "pending" && ev.depositAmount > 0 && !reg.depositPaid;
  if (!owesFee && !owesDeposit) return null;
  return {
    bankBin: priv.payoutBankBin ?? null,
    accountNo: priv.payoutAccountNo ?? null,
    accountName: priv.payoutAccountName ?? null,
  };
}

/**
 * Một buổi theo mã công khai. Phần công khai dùng chung cache; phần theo người
 * xem (đăng ký của mình, liên hệ, tên người tham gia) đọc theo request và chỉ
 * mở cho host và đăng ký `approved`. Buổi ẩn hoặc host hết hiệu lực chỉ thấy
 * được với host và người đã có đăng ký.
 */
export async function getExchangeEvent(
  code: string,
): Promise<{ event: PublicExchangeEvent; viewer: ViewerExtras } | null> {
  if ("error" in (await exchangeGate())) return null;
  if (typeof code !== "string" || !/^[A-Za-z0-9]{4,40}$/.test(code))
    return null;

  const pub = await getPublicEventCached(code);
  if (!pub) return null;

  const viewer = await getExchangeViewer();
  if (viewer.status !== "ok") {
    return pub.event.hidden || !pub.hostActive
      ? null
      : { event: pub.event, viewer: guestExtras() };
  }
  const { member } = viewer;
  const isHost = pub.hostMemberId === member.id;

  const [reg] = await db
    .select()
    .from(exchangeRegistrations)
    .where(
      and(
        eq(exchangeRegistrations.eventId, pub.eventId),
        eq(exchangeRegistrations.memberId, member.id),
      ),
    )
    .limit(1);

  if ((pub.event.hidden || !pub.hostActive) && !isHost && !reg) return null;

  const [blocked, limits] = await Promise.all([
    isHost
      ? Promise.resolve(false)
      : isBlockedByHost(db, pub.hostMemberId, member.id),
    newAccountLimits(db, member),
  ]);

  const extras: ViewerExtras = {
    role: isHost ? "host" : "member",
    myRegistration: null,
    skillWarning: isHost
      ? null
      : skillWarningFor(
          member.skillLevel ?? null,
          pub.event.skillMin,
          pub.event.skillMax,
        ),
    hostContact: null,
    zaloGroupLink: null,
    payout: null,
    attendees: null,
    blocked,
    isNewAccount: limits.isNew,
  };

  if (reg) {
    const s = registrationSettlement(
      reg,
      pub.event.depositAmount,
      pub.event.status,
    );
    extras.myRegistration = {
      id: reg.id,
      status: reg.status,
      maleCount: reg.maleCount,
      femaleCount: reg.femaleCount,
      feeAmount: reg.feeAmount ?? null,
      feeWaived: reg.feeWaived,
      depositPaid: reg.depositPaid,
      paid: reg.paid,
      waitlistPos: reg.waitlistPos ?? null,
      remaining: s.remaining,
      refundDue: s.refundDue,
    };
  }

  const approved = reg?.status === "approved";
  const wantsPayout =
    !!reg && reg.status === "pending" && pub.event.depositAmount > 0;
  // R26: ai còn nợ hay được hoàn (kể cả huỷ muộn, vắng mặt bị tính phí) cần
  // tài khoản nhận tiền và liên hệ host để trả hoặc nhận lại.
  const money = extras.myRegistration;
  const owesOrOwed = !!money && (money.remaining > 0 || money.refundDue > 0);
  if (isHost || approved || wantsPayout || owesOrOwed) {
    const [priv] = await db
      .select({
        hostContact: exchangeEvents.hostContact,
        zaloGroupLink: exchangeEvents.zaloGroupLink,
        payoutBankBin: exchangeEvents.payoutBankBin,
        payoutAccountNo: exchangeEvents.payoutAccountNo,
        payoutAccountName: exchangeEvents.payoutAccountName,
      })
      .from(exchangeEvents)
      .where(eq(exchangeEvents.id, pub.eventId))
      .limit(1);
    if (isHost || approved) {
      extras.hostContact = priv?.hostContact ?? null;
      extras.zaloGroupLink = priv?.zaloGroupLink ?? null;
      extras.attendees = await db
        .select({
          name: members.name,
          avatarUrl: members.avatarUrl,
          avatarKey: members.avatarKey,
        })
        .from(exchangeRegistrations)
        .innerJoin(members, eq(members.id, exchangeRegistrations.memberId))
        .where(
          and(
            eq(exchangeRegistrations.eventId, pub.eventId),
            eq(exchangeRegistrations.status, "approved"),
          ),
        )
        .orderBy(asc(exchangeRegistrations.id));
    } else if (owesOrOwed) {
      extras.hostContact = priv?.hostContact ?? null;
    }
    if (reg && !isHost) extras.payout = payoutFor(pub.event, reg, priv);
  }

  return { event: pub.event, viewer: extras };
}

// ---------------------------------------------------------------------------
// Danh sách (thẻ)
// ---------------------------------------------------------------------------

const publicListWhere = (nowIso: string) =>
  and(
    eq(venues.status, "approved"),
    inArray(exchangeEvents.status, [...OPEN_STATUSES]),
    isNull(exchangeEvents.hiddenAt),
    activeHostWhere,
    gte(exchangeEvents.startAt, nowIso),
  );

/** Mốc 00:00 giờ VN của `date` và của ngày kế, dạng ISO UTC để so với `start_at`. */
function vnDayBounds(date: string): { from: string; to: string } {
  const start = sessionStartInstant(date, "00:00");
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

/**
 * Ứng viên quanh một ô lưới, có cache. Khoá là (ô lưới, bán kính, ngày) chứ
 * không phải toạ độ thật, đúng mẫu `getCandidatesNearCell` của danh bạ sân.
 */
const getEventCandidatesNearCell = unstable_cache(
  async (
    cellLat: number,
    cellLng: number,
    radiusKm: number,
    date: string,
  ): Promise<Candidate[]> => {
    const bb = boundingBox(
      { lat: cellLat, lng: cellLng },
      radiusKm * 1000 + GRID_MARGIN_M,
    );
    const cosLat = Math.cos((cellLat * Math.PI) / 180);
    const nowIso = new Date().toISOString();
    const day = date ? vnDayBounds(date) : null;
    const rows = await db
      .select(candidateColumns)
      .from(exchangeEvents)
      .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
      .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
      .where(
        and(
          publicListWhere(nowIso),
          sql`${venues.lat} BETWEEN ${bb.minLat} AND ${bb.maxLat}`,
          sql`${venues.lng} BETWEEN ${bb.minLng} AND ${bb.maxLng}`,
          day ? gte(exchangeEvents.startAt, day.from) : undefined,
          day ? lt(exchangeEvents.startAt, day.to) : undefined,
        ),
      )
      // Sắp theo khoảng cách TRƯỚC khi cắt, không thì buổi gần nhất có thể bị loại.
      .orderBy(
        sql`(${venues.lat} - ${cellLat}) * (${venues.lat} - ${cellLat}) + ((${venues.lng} - ${cellLng}) * ${cosLat}) * ((${venues.lng} - ${cellLng}) * ${cosLat})`,
        asc(exchangeEvents.startAt),
      )
      .limit(CANDIDATE_LIMIT);
    return attachGroups(rows);
  },
  ["exchange-near"],
  { revalidate: 60, tags: ["exchange"] },
);

const nearSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  radiusKm: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(20)]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate)
    .optional(),
  timeOfDay: z.enum(["morning", "afternoon", "evening"]).optional(),
  skill: z.enum(SKILL_LEVELS).optional(),
  hasSlot: z.boolean().optional(),
  hasFemaleSlot: z.boolean().optional(),
  maxFee: z.number().int().min(0).optional(),
});

function skillFits(c: Candidate, level: SkillLevel): boolean {
  const i = SKILL_LEVELS.indexOf(level);
  if (c.skillMin && i < SKILL_LEVELS.indexOf(c.skillMin)) return false;
  if (c.skillMax && i > SKILL_LEVELS.indexOf(c.skillMax)) return false;
  return true;
}

/**
 * Buổi giao lưu quanh một điểm, sắp gần nhất. Công khai. Vị trí người dùng chỉ
 * dùng trong request này, không lưu, không log.
 */
export async function listExchangesNear(q: {
  lat: number;
  lng: number;
  radiusKm: 3 | 5 | 10 | 20;
  date?: string;
  timeOfDay?: "morning" | "afternoon" | "evening";
  skill?: SkillLevel;
  hasSlot?: boolean;
  hasFemaleSlot?: boolean;
  maxFee?: number;
}): Promise<{ events: ExchangeCard[] } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const parsed = nearSchema.safeParse(q);
  if (!parsed.success) {
    const t = await getTranslations("exchange.errors");
    // Ngày không có thật làm `vnDayBounds` ném RangeError trong cache: chặn ở đây.
    const badDate = parsed.error.issues.some((i) => i.path[0] === "date");
    return { error: t(badDate ? "invalidSearch" : "notFound") };
  }
  const f = parsed.data;
  const cell = snapToGrid({ lat: f.lat, lng: f.lng });
  const candidates = await getEventCandidatesNearCell(
    cell.lat,
    cell.lng,
    f.radiusKm,
    f.date ?? "",
  );

  const now = new Date();
  const radiusM = f.radiusKm * 1000;
  const cards: ExchangeCard[] = [];
  for (const c of candidates) {
    // Cache sống tới 60s nên buổi vừa qua giờ bắt đầu phải lọc lại ở đây.
    if (new Date(c.startAt).getTime() < now.getTime()) continue;
    const distanceM = Math.round(
      haversineMeters(
        { lat: f.lat, lng: f.lng },
        { lat: c.venueLat, lng: c.venueLng },
      ),
    );
    if (distanceM > radiusM) continue;
    if (f.timeOfDay && vnTimeOfDay(c.startAt) !== f.timeOfDay) continue;
    if (f.skill && !skillFits(c, f.skill)) continue;
    const card = toCard(c, now, distanceM);
    // `hasSlot`: còn suất người nam cũng nhận được; `hasFemaleSlot`: còn bất kỳ suất nào.
    if (f.hasSlot && card.counts.freeTotal - card.counts.freeFemaleOnly <= 0)
      continue;
    if (f.hasFemaleSlot && card.counts.freeTotal <= 0) continue;
    if (f.maxFee !== undefined) {
      const fee = card.fee;
      const male =
        fee.kind === "fixed"
          ? fee.male
          : fee.kind === "split"
            ? fee.estimate.male
            : fee.rates.male;
      if (male > f.maxFee) continue;
    }
    cards.push(card);
  }
  cards.sort(
    (a, b) =>
      (a.distanceM ?? 0) - (b.distanceM ?? 0) ||
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  return { events: cards.slice(0, LIST_LIMIT) };
}

// ---------------------------------------------------------------------------
// Theo sân
// ---------------------------------------------------------------------------

const getUpcomingAtVenueCached = unstable_cache(
  async (venueId: number): Promise<Candidate[]> => {
    const rows = await db
      .select(candidateColumns)
      .from(exchangeEvents)
      .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
      .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
      .where(
        and(
          publicListWhere(new Date().toISOString()),
          eq(exchangeEvents.venueId, venueId),
        ),
      )
      .orderBy(asc(exchangeEvents.startAt))
      .limit(LIST_LIMIT);
    return attachGroups(rows);
  },
  ["exchange-venue"],
  { revalidate: 60, tags: ["exchange"] },
);

/** Buổi sắp diễn ra tại một sân đã duyệt, gần giờ nhất trước. */
export async function listUpcomingAtVenue(
  venueId: number,
): Promise<ExchangeCard[]> {
  if ("error" in (await exchangeGate())) return [];
  if (!Number.isInteger(venueId) || venueId <= 0) return [];
  const now = new Date();
  const rows = await getUpcomingAtVenueCached(venueId);
  return rows
    .filter((c) => new Date(c.startAt).getTime() >= now.getTime())
    .map((c) => toCard(c, now, null));
}

const getCountsCached = unstable_cache(
  async (idsKey: string): Promise<[number, number][]> => {
    const ids = idsKey.split(",").map(Number);
    const rows = await db
      .select({
        venueId: exchangeEvents.venueId,
        n: sql<number>`COUNT(*)`,
      })
      .from(exchangeEvents)
      .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
      .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
      .where(
        and(
          publicListWhere(new Date().toISOString()),
          inArray(exchangeEvents.venueId, ids),
        ),
      )
      .groupBy(exchangeEvents.venueId);
    // Mảng cặp, không Map: cache lưu bằng JSON.stringify.
    return rows.map((r) => [r.venueId, Number(r.n)] as [number, number]);
  },
  ["exchange-venue-counts"],
  { revalidate: 60, tags: ["exchange"] },
);

/** Số buổi sắp diễn ra theo sân. Trả mảng cặp; client tự dựng `Map`. */
export async function countUpcomingByVenue(
  venueIds: number[],
): Promise<[number, number][]> {
  if ("error" in (await exchangeGate())) return [];
  if (!Array.isArray(venueIds)) return [];
  const ids = [...new Set(venueIds.filter((n) => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b)
    .slice(0, 200);
  if (ids.length === 0) return [];
  return getCountsCached(ids.join(","));
}
