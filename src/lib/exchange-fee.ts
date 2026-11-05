import { CHARGEABLE_STATUSES, type FeeMode } from "./exchange/constants";
import {
  computeGroupPlayRates,
  GROUP_KEYS,
  type GroupKey,
  type GroupPolicy,
} from "./group-policy";

/**
 * Phí giao lưu theo đầu người. Module THUẦN (không DB, không server-only) để
 * trang xem trước ở client dùng chung với đường chốt phí ở server.
 *
 * Tiền là số nguyên VND. Cách chia đi qua `computeGroupPlayRates` (không có
 * công thức chia riêng); cách cố định trả thẳng số host nhập.
 */

export type ExchangeFeeConfig = {
  feeMode: FeeMode;
  feeAmountMale: number | null;
  feeAmountFemale: number | null;
  feeFemalePercent: number | null;
  estimatedTotalCost: number | null;
  minHeads: number | null;
  hostHeads: number | null;
};

export type HeadRates = { male: number; female: number };

const EQUAL: GroupPolicy = { mode: "equal", amount: 0, capAtEqual: false };

/** Số nguyên không âm; null, NaN hay số âm về 0 để không chảy ra tiền lạ. */
function money(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : 0;
}

function headCount(n: number | null | undefined): number {
  return money(n);
}

function splitRates(
  cfg: ExchangeFeeConfig,
  heads: { male: number; female: number },
): HeadRates {
  const headsByGroup = {} as Record<GroupKey, number>;
  const policies = {} as Record<GroupKey, GroupPolicy>;
  for (const k of GROUP_KEYS) {
    headsByGroup[k] = 0;
    policies[k] = EQUAL;
  }
  // Host không phải dòng đăng ký nhưng có trong mẫu số, tính như nam.
  headsByGroup.member = headCount(heads.male) + headCount(cfg.hostHeads);
  headsByGroup.memberFemale = headCount(heads.female);

  if (cfg.feeMode === "split_female_discount") {
    if (cfg.feeFemalePercent !== null && cfg.feeFemalePercent !== undefined) {
      policies.memberFemale = {
        mode: "percent",
        amount: 0,
        capAtEqual: false,
        percent: cfg.feeFemalePercent,
      };
    } else if (cfg.feeAmountFemale !== null) {
      policies.memberFemale = {
        mode: "fixed",
        amount: money(cfg.feeAmountFemale),
        capAtEqual: true,
      };
    }
    // Không có số nào cho nữ: để chia đều, thà thu đủ còn hơn miễn ngầm.
  }

  const rates = computeGroupPlayRates({
    totalPlayCost: money(cfg.estimatedTotalCost),
    headsByGroup,
    policies,
  });
  return { male: rates.member, female: rates.memberFemale };
}

/**
 * Suất mỗi đầu người theo số đầu người thật (`heads` = tổng số nam/nữ đang bị
 * tính, KHÔNG gồm host; host cộng qua `cfg.hostHeads`).
 *
 * Cách cố định không gọi engine: khi rổ chia đều rỗng engine trả trung bình
 * (group-policy.ts, nhánh `poolWeight100 <= 0`) và làm mất số host đã nhập.
 */
export function computeExchangeFees(
  cfg: ExchangeFeeConfig,
  heads: { male: number; female: number },
): HeadRates {
  switch (cfg.feeMode) {
    case "fixed": {
      const amount = money(cfg.feeAmountMale);
      return { male: amount, female: amount };
    }
    case "fixed_gender":
      return {
        male: money(cfg.feeAmountMale),
        female: money(cfg.feeAmountFemale),
      };
    case "split_equal":
    case "split_female_discount":
      return splitRates(cfg, heads);
  }
}

/**
 * Mức hiển thị trước khi chốt: `minHeads` nam cộng host cho cách chia, chính
 * số cố định cho cách cố định. Với `split_equal` đây là mức tối đa thật; với
 * `split_female_discount` chỉ là ước tính, nữ đông hơn dự kiến thì nam trả
 * cao hơn (quyết định 32).
 */
export function exchangeFeeEstimate(cfg: ExchangeFeeConfig): HeadRates {
  const est = computeExchangeFees(cfg, {
    male: headCount(cfg.minHeads),
    female: 0,
  });
  // Estimate runs with 0 women, and the engine drops a 0-head group into the
  // shared equal pool, which would ignore a fixed female amount. Apply the
  // same rule here: fixed, capped at the equal share (mirrors splitRates).
  if (
    cfg.feeMode === "split_female_discount" &&
    (cfg.feeFemalePercent === null || cfg.feeFemalePercent === undefined) &&
    cfg.feeAmountFemale !== null
  ) {
    return {
      male: est.male,
      female: Math.min(money(cfg.feeAmountFemale), est.male),
    };
  }
  return est;
}

export function registrationFee(
  rates: HeadRates,
  r: { maleCount: number; femaleCount: number },
): number {
  return (
    rates.male * headCount(r.maleCount) +
    rates.female * headCount(r.femaleCount)
  );
}

const CHARGEABLE = new Set<string>(CHARGEABLE_STATUSES);

/**
 * Chốt phí: chỉ đăng ký `CHARGEABLE_STATUSES` không `waived` vào mẫu số và bị
 * tính. Trả mảng (không `Map`) để đi qua cache/JSON an toàn.
 */
export function computeLockedFees(
  cfg: ExchangeFeeConfig,
  regs: {
    id: number;
    status: string;
    maleCount: number;
    femaleCount: number;
    waived: boolean;
  }[],
): {
  rates: HeadRates;
  fees: { id: number; amount: number }[];
  chargedHeads: number;
  aboveEstimate: boolean;
} {
  const charged = regs.filter((r) => CHARGEABLE.has(r.status) && !r.waived);
  const male = charged.reduce((s, r) => s + headCount(r.maleCount), 0);
  const female = charged.reduce((s, r) => s + headCount(r.femaleCount), 0);

  const rates = computeExchangeFees(cfg, { male, female });
  const estimate = exchangeFeeEstimate(cfg);
  const chargedSet = new Set(charged);

  return {
    rates,
    fees: regs.map((r) => ({
      id: r.id,
      amount: chargedSet.has(r) ? registrationFee(rates, r) : 0,
    })),
    chargedHeads: male + female,
    aboveEstimate: rates.male > estimate.male || rates.female > estimate.female,
  };
}

/**
 * Đối trừ tiền cọc với phí đã chốt (I8). Chưa có phí (null) tính như 0.
 */
export function depositSettlement(
  r: { depositPaid: boolean; feeAmount: number | null },
  depositAmount: number,
): { remaining: number; refundDue: number } {
  const paidDeposit = r.depositPaid ? money(depositAmount) : 0;
  const fee = money(r.feeAmount);
  return {
    remaining: Math.max(0, fee - paidDeposit),
    refundDue: Math.max(0, paidDeposit - fee),
  };
}

/**
 * Đối trừ đủ cho một đăng ký: nếu host đã đánh dấu đã trả thì `paidAmount` là
 * số tiền thật đã nhận (đã gồm cọc), nên nó thay cho tiền cọc. Chốt lại phí
 * thấp hơn hoặc bỏ người đó (feeAmount null) thì phần dư hiện ở `refundDue`.
 * Nguồn DUY NHẤT cho số còn phải trả / được hoàn của một đăng ký: thông báo,
 * màn host, màn thành viên và QR đều đi qua đây. `eventStatus = "cancelled"`
 * coi phí là null. Vẫn dùng `depositSettlement`, không có công thức thứ hai.
 */
export function registrationSettlement(
  r: {
    depositPaid: boolean;
    feeAmount: number | null;
    paid: boolean;
    paidAmount: number | null;
  },
  depositAmount: number,
  eventStatus?: string,
): { remaining: number; refundDue: number } {
  // Buổi đã huỷ: không còn phí, mọi khoản đã nhận đều phải hoàn.
  const feeAmount = eventStatus === "cancelled" ? null : r.feeAmount;
  // `paid` mà thiếu `paidAmount` (dữ liệu cũ): coi như đã trả đúng phí chốt.
  if (r.paid)
    return depositSettlement(
      { depositPaid: true, feeAmount },
      r.paidAmount ?? money(r.feeAmount),
    );
  return depositSettlement(
    { depositPaid: r.depositPaid, feeAmount },
    depositAmount,
  );
}
