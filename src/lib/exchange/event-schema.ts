import { z } from "zod";
import { sessionStartInstant } from "@/lib/notifications/time";
import { SKILL_LEVELS } from "@/lib/skill-level";
import { VN_BANKS } from "@/lib/vn-banks";
import {
  MAX_FEE_PER_HEAD,
  MAX_HOST_HEADS,
  MAX_SLOTS,
  MAX_TOTAL_COST,
} from "./constants";

/**
 * Schema dùng chung cho form mở buổi (client) và server action. Module thuần,
 * không `server-only`, để form validate đúng luật server sẽ áp.
 *
 * Mỗi cách tính phí bắt buộc ĐỦ các trường nó cần: module phí coi số thiếu là
 * 0, nên thiếu ở đây thành buổi miễn phí âm thầm.
 */

const money = (max: number) => z.number().int().min(0).max(max);
const feePerHead = money(MAX_FEE_PER_HEAD);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^(?:0\d{9}|\+84\d{9})$/;
const ZALO_LINK_RE = /^https:\/\/zalo\.me\/[\w\-./?=&%]+$/;
const ZALO_GROUP_RE = /^https:\/\/zalo\.me\/g\/[\w\-./?=&%]+$/;
const ACCOUNT_NO_RE = /^\d{6,20}$/;
const ACCOUNT_NAME_RE = /^[A-Z0-9 ]{1,50}$/;
const BANK_BINS: ReadonlySet<string> = new Set(VN_BANKS.map((b) => b.bin));

/** Tuỳ chọn (R15): rỗng = host không để liên hệ; có giá trị thì vẫn phải đúng dạng. */
export const hostContactSchema = z
  .string()
  .trim()
  .max(100)
  .refine((v) => v === "" || PHONE_RE.test(v) || ZALO_LINK_RE.test(v));

/** Ngày có thật (R17): `Date.parse` bù ngày tràn (2026-02-31 thành 03-03), nên dựng lại rồi so. */
export function isRealDate(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Rỗng nghĩa là không có link nhóm. */
export const zaloGroupLinkSchema = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === "" || ZALO_GROUP_RE.test(v));

export const payoutSchema = z.object({
  bankBin: z.string().refine((v) => BANK_BINS.has(v)),
  accountNo: z.string().regex(ACCOUNT_NO_RE),
  accountName: z.string().regex(ACCOUNT_NAME_RE),
});
export type Payout = z.infer<typeof payoutSchema>;

export const RESERVE_RELEASES = ["deadline", "h24", "h6", "never"] as const;
export type ReserveRelease = (typeof RESERVE_RELEASES)[number];

const common = z.object({
  venueId: z.number().int().positive(),
  date: z.string().regex(DATE_RE).refine(isRealDate),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  title: z.string().trim().min(5).max(80),
  description: z.string().max(2000).default(""),
  skillMin: z.enum(SKILL_LEVELS).nullish(),
  skillMax: z.enum(SKILL_LEVELS).nullish(),
  slotsTotal: z.number().int().min(1).max(MAX_SLOTS),
  femaleReservedSlots: z.number().int().min(0).default(0),
  reserveRelease: z.enum(RESERVE_RELEASES).default("never"),
  hostHeads: z.number().int().min(0).max(MAX_HOST_HEADS).default(1),
  shuttleType: z.string().trim().max(60).default(""),
  depositAmount: money(MAX_FEE_PER_HEAD).default(0),
  registerDeadlineHours: z.number().int().min(0).max(72).default(2),
  cancelDeadlineHours: z.number().int().min(0).max(72).default(12),
  autoApprove: z.boolean().default(false),
  allowPlusOnes: z.boolean().default(false),
  // Phẳng ở form; rỗng = chưa nhập. Đủ cả ba hoặc không có gì (xem superRefine).
  payoutBankBin: z.string().optional(),
  payoutAccountNo: z.string().optional(),
  payoutAccountName: z.string().optional(),
  hostContact: hostContactSchema.default(""),
  zaloGroupLink: zaloGroupLinkSchema.default(""),
  turnstileToken: z.string().min(1).max(4096),
  idempotencyKey: z.string().uuid(),
});

const totalCost = z.number().int().min(1000).max(MAX_TOTAL_COST);
const minHeads = z.number().int().min(1).max(MAX_SLOTS);

const variants = [
  common.extend({
    feeMode: z.literal("fixed"),
    feeAmountMale: feePerHead,
  }),
  common.extend({
    feeMode: z.literal("fixed_gender"),
    feeAmountMale: feePerHead,
    feeAmountFemale: feePerHead,
  }),
  common.extend({
    feeMode: z.literal("split_equal"),
    estimatedTotalCost: totalCost,
    minHeads,
  }),
  common.extend({
    feeMode: z.literal("split_female_discount"),
    estimatedTotalCost: totalCost,
    minHeads,
    feeFemalePercent: z.number().int().min(0).max(100).optional(),
    feeAmountFemale: feePerHead.optional(),
  }),
] as const;

export const eventFormSchema = z
  .discriminatedUnion("feeMode", variants)
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (v.endTime <= v.startTime) bad("endTime", "endBeforeStart");
    if (v.femaleReservedSlots > v.slotsTotal)
      bad("femaleReservedSlots", "tooMany");
    if (
      v.skillMin &&
      v.skillMax &&
      SKILL_LEVELS.indexOf(v.skillMin) > SKILL_LEVELS.indexOf(v.skillMax)
    )
      bad("skillMin", "skillRange");

    if (
      (v.feeMode === "split_equal" || v.feeMode === "split_female_discount") &&
      v.minHeads > v.slotsTotal
    )
      bad("minHeads", "tooMany");
    if (
      v.feeMode === "split_female_discount" &&
      v.feeFemalePercent === undefined &&
      v.feeAmountFemale === undefined
    )
      bad("feeFemalePercent", "required");

    const given = [v.payoutBankBin, v.payoutAccountNo, v.payoutAccountName];
    const filled = given.filter((x) => x && x.length > 0).length;
    if (filled > 0) {
      const r = payoutSchema.safeParse({
        bankBin: v.payoutBankBin ?? "",
        accountNo: v.payoutAccountNo ?? "",
        accountName: v.payoutAccountName ?? "",
      });
      if (!r.success) bad("payoutBankBin", "payout");
    }
  });

export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventForm = z.output<typeof eventFormSchema>;

const MIN_LEAD_MS = 30 * 60_000;
const MAX_LEAD_MS = 60 * 86_400_000;
const MIN_DEADLINE_GAP_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export type ResolvedTimes = {
  startAt: string;
  endAt: string;
  registerDeadline: string;
  cancelDeadline: string;
  reserveReleaseAt: string | null;
};

/**
 * Đổi giờ VN của form sang instant UTC. Bắt đầu phải từ 30 phút tới 60 ngày
 * sau `now`; hạn đăng ký/huỷ = bắt đầu trừ N giờ nhưng không sớm hơn
 * `now + 5 phút` (nếu không, buổi mở sát giờ có hạn đã trôi qua từ trước).
 */
export function resolveEventTimes(
  input: {
    date: string;
    startTime: string;
    endTime: string;
    registerDeadlineHours: number;
    cancelDeadlineHours: number;
    reserveRelease: ReserveRelease;
    femaleReservedSlots: number;
  },
  now: Date,
): ResolvedTimes | { error: "startInvalid" | "startTooSoon" | "startTooFar" } {
  const start = sessionStartInstant(input.date, input.startTime);
  const end = sessionStartInstant(input.date, input.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return { error: "startInvalid" };
  const lead = start.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) return { error: "startTooSoon" };
  if (lead > MAX_LEAD_MS) return { error: "startTooFar" };

  const floor = now.getTime() + MIN_DEADLINE_GAP_MS;
  const before = (hours: number) =>
    new Date(Math.max(start.getTime() - hours * HOUR_MS, floor));
  const registerDeadline = before(input.registerDeadlineHours);

  let release: Date | null = null;
  if (input.femaleReservedSlots > 0) {
    if (input.reserveRelease === "deadline") release = registerDeadline;
    else if (input.reserveRelease === "h24")
      release = new Date(start.getTime() - 24 * HOUR_MS);
    else if (input.reserveRelease === "h6")
      release = new Date(start.getTime() - 6 * HOUR_MS);
  }

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    registerDeadline: registerDeadline.toISOString(),
    cancelDeadline: before(input.cancelDeadlineHours).toISOString(),
    reserveReleaseAt: release ? release.toISOString() : null,
  };
}
