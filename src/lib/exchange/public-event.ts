import type { exchangeEvents, venues } from "@/db/schema";
import {
  computeExchangeFees,
  computeLockedFees,
  exchangeFeeEstimate,
  type ExchangeFeeConfig,
  type HeadRates,
} from "@/lib/exchange-fee";
import { slotState } from "./slots";
import type { ExchangeEventStatus, FeeMode } from "./constants";
import type { SkillLevel } from "@/lib/skill-level";

type EventRow = typeof exchangeEvents.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

/** Cách hiển thị phí. `split.estimateIsCap` chỉ true với `split_equal` (mức tối đa thật). */
export type FeeDisplay =
  | { kind: "fixed"; male: number; female: number }
  | {
      kind: "split";
      estimate: HeadRates;
      current: HeadRates;
      minHeads: number;
      currentHeads: number;
      estimateIsCap: boolean;
    }
  | { kind: "locked"; rates: HeadRates; aboveEstimate: boolean };

export type PublicExchangeEvent = {
  code: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  status: ExchangeEventStatus;
  hidden: boolean;
  venue: {
    id: number;
    name: string;
    address: string | null;
    areaLabel: string | null;
    lat: number;
    lng: number;
    mapLink: string | null;
  };
  host: {
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    /** Mã hồ sơ công khai; `null` khi host chưa có. */
    code: string | null;
  };
  skillMin: SkillLevel | null;
  skillMax: SkillLevel | null;
  slotsTotal: number;
  femaleReservedSlots: number;
  reserveReleaseAt: string | null;
  shuttleType: string | null;
  feeMode: FeeMode;
  fee: FeeDisplay;
  depositAmount: number;
  registerDeadline: string;
  cancelDeadline: string;
  autoApprove: boolean;
  allowPlusOnes: boolean;
  counts: {
    approvedHeads: number;
    pendingHeads: number;
    waitlistHeads: number;
    freeTotal: number;
    freeFemaleOnly: number;
  };
  attendeeAvatars: { avatarUrl: string | null; avatarKey: string | null }[];
  createdAt: string;
};

/** Whitelist: thêm cột vào đây là quyết định có chủ ý, không phải vô tình. */
export const PUBLIC_EXCHANGE_EVENT_KEYS: readonly (keyof PublicExchangeEvent)[] =
  [
    "code",
    "title",
    "description",
    "startAt",
    "endAt",
    "status",
    "hidden",
    "venue",
    "host",
    "skillMin",
    "skillMax",
    "slotsTotal",
    "femaleReservedSlots",
    "reserveReleaseAt",
    "shuttleType",
    "feeMode",
    "fee",
    "depositAmount",
    "registerDeadline",
    "cancelDeadline",
    "autoApprove",
    "allowPlusOnes",
    "counts",
    "attendeeAvatars",
    "createdAt",
  ];

export type ExchangeCard = Pick<
  PublicExchangeEvent,
  | "code"
  | "title"
  | "startAt"
  | "endAt"
  | "status"
  | "skillMin"
  | "skillMax"
  | "slotsTotal"
  | "fee"
  | "counts"
> & {
  venue: {
    id: number;
    name: string;
    lat: number;
    lng: number;
    areaLabel: string | null;
  };
  host: { name: string; avatarUrl: string | null; avatarKey: string | null };
  /** Mét từ vị trí người xem; `null` khi không biết vị trí (không hiện khoảng cách). */
  distanceM: number | null;
};

/** Đủ để đếm slot và tính phí; nhóm theo trạng thái cũng dùng được (1 dòng = 1 nhóm). */
export type RegLike = {
  id: number;
  status: string;
  maleCount: number;
  femaleCount: number;
  waitlistPos: number | null;
  feeWaived: boolean;
  /** Phí đã chốt; có mặt thì giá khi khoá tính theo nó, không theo trạng thái hiện tại. */
  feeAmount?: number | null;
};

type FeeEvent = ExchangeFeeConfig & { status: string };
type CountEvent = {
  slotsTotal: number;
  femaleReservedSlots: number;
  reserveReleaseAt: string | null;
};

function feeConfig(ev: FeeEvent): ExchangeFeeConfig {
  return {
    feeMode: ev.feeMode,
    feeAmountMale: ev.feeAmountMale,
    feeAmountFemale: ev.feeAmountFemale,
    feeFemalePercent: ev.feeFemalePercent,
    estimatedTotalCost: ev.estimatedTotalCost,
    minHeads: ev.minHeads,
    hostHeads: ev.hostHeads,
  };
}

export function buildFeeDisplay(
  ev: FeeEvent,
  regs: readonly RegLike[],
): FeeDisplay {
  const cfg = feeConfig(ev);
  if (cfg.feeMode === "fixed" || cfg.feeMode === "fixed_gender") {
    const est = exchangeFeeEstimate(cfg);
    return { kind: "fixed", male: est.male, female: est.female };
  }
  if (ev.status === "locked" || ev.status === "done") {
    const locked = computeLockedFees(
      cfg,
      regs.map((r) => ({
        id: r.id,
        // Đã chốt: tính theo người bị tính ở lần chốt gần nhất (feeAmount đã
        // lưu), không theo trạng thái hiện tại, để huỷ sau chốt không đổi giá.
        status:
          r.feeAmount === undefined
            ? r.status
            : r.feeAmount !== null
              ? "approved"
              : "cancelled",
        maleCount: r.maleCount,
        femaleCount: r.femaleCount,
        waived: r.feeWaived,
      })),
    );
    return {
      kind: "locked",
      rates: locked.rates,
      aboveEstimate: locked.aboveEstimate,
    };
  }
  let male = 0;
  let female = 0;
  for (const r of regs) {
    if (r.status !== "pending" && r.status !== "approved") continue;
    male += r.maleCount;
    female += r.femaleCount;
  }
  return {
    kind: "split",
    estimate: exchangeFeeEstimate(cfg),
    current: computeExchangeFees(cfg, { male, female }),
    minHeads: cfg.minHeads ?? 0,
    currentHeads: male + female,
    estimateIsCap: cfg.feeMode === "split_equal",
  };
}

export function buildCounts(
  ev: CountEvent,
  regs: readonly RegLike[],
  now: Date,
): PublicExchangeEvent["counts"] {
  let approvedHeads = 0;
  let pendingHeads = 0;
  let waitlistHeads = 0;
  for (const r of regs) {
    const h = r.maleCount + r.femaleCount;
    if (r.status === "approved") approvedHeads += h;
    else if (r.status === "pending") pendingHeads += h;
    else if (r.status === "waitlist") waitlistHeads += h;
  }
  const s = slotState(ev, regs, now);
  return {
    approvedHeads,
    pendingHeads,
    waitlistHeads,
    freeTotal: s.freeTotal,
    freeFemaleOnly: s.freeFemaleOnly,
  };
}

/** Dựng từng key một: không spread row, nên cột mới không tự lộ ra ngoài. */
export function toPublicExchangeEvent(input: {
  event: EventRow;
  venue: VenueRow;
  host: {
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    code?: string | null;
  };
  regs: readonly RegLike[];
  attendeeAvatars: { avatarUrl: string | null; avatarKey: string | null }[];
  now: Date;
}): PublicExchangeEvent {
  const { event: e, venue: v, host, regs, now } = input;
  return {
    code: e.publicCode,
    title: e.title,
    description: e.description ?? null,
    startAt: e.startAt,
    endAt: e.endAt,
    status: e.status,
    hidden: e.hiddenAt !== null,
    venue: {
      id: v.id,
      name: v.name,
      address: v.address ?? null,
      areaLabel: v.areaLabel ?? null,
      lat: v.lat,
      lng: v.lng,
      mapLink: v.mapLink ?? null,
    },
    host: {
      name: host.name,
      avatarUrl: host.avatarUrl ?? null,
      avatarKey: host.avatarKey ?? null,
      code: host.code ?? null,
    },
    skillMin: e.skillMin ?? null,
    skillMax: e.skillMax ?? null,
    slotsTotal: e.slotsTotal,
    femaleReservedSlots: e.femaleReservedSlots,
    reserveReleaseAt: e.reserveReleaseAt ?? null,
    shuttleType: e.shuttleType ?? null,
    feeMode: e.feeMode,
    fee: buildFeeDisplay(e, regs),
    depositAmount: e.depositAmount,
    registerDeadline: e.registerDeadline,
    cancelDeadline: e.cancelDeadline,
    autoApprove: e.autoApprove,
    allowPlusOnes: e.allowPlusOnes,
    counts: buildCounts(e, regs, now),
    attendeeAvatars: input.attendeeAvatars.map((a) => ({
      avatarUrl: a.avatarUrl ?? null,
      avatarKey: a.avatarKey ?? null,
    })),
    createdAt: e.createdAt,
  };
}

/** Giờ trong ngày theo giờ VN (UTC+7, không DST) nên không phụ thuộc TZ của server. */
export function vnTimeOfDay(
  startAtIso: string,
): "morning" | "afternoon" | "evening" {
  const hour = new Date(
    new Date(startAtIso).getTime() + 7 * 3_600_000,
  ).getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
