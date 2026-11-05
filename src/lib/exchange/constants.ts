/** Nguồn duy nhất cho enum và giới hạn của luồng giao lưu (G2b). */

export const EXCHANGE_EVENT_STATUSES = [
  "open",
  "full",
  "locked",
  "done",
  "cancelled",
] as const;

export const EXCHANGE_REG_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "waitlist",
  "cancelled",
  "late_cancelled",
  "no_show",
] as const;

/** Trạng thái giữ slot. `waitlist` không giữ slot. */
export const HOLDING_STATUSES = ["pending", "approved"] as const;

/** Trạng thái bị tính phí khi chốt. */
export const CHARGEABLE_STATUSES = [
  "approved",
  "no_show",
  "late_cancelled",
] as const;

export const FEE_MODES = [
  "fixed",
  "fixed_gender",
  "split_equal",
  "split_female_discount",
] as const;

// G2c thêm `comment`, G2d thêm `review`, `venue`: chỉ ở TS, không đổi DB.
export const REPORT_TARGET_TYPES = ["member", "event"] as const;

export const REPORT_REASONS = [
  "spam",
  "fake_account",
  "abusive",
  "wrong_info",
  "no_show",
  "other",
] as const;

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;

export const MAX_COMPANIONS = 2;
export const NEW_ACCOUNT_MAX_WAITING = 2;
export const MAX_SLOTS = 60;
export const MAX_HOST_HEADS = 10;
export const MAX_FEE_PER_HEAD = 2_000_000;
export const MAX_TOTAL_COST = 50_000_000;
export const LIST_LIMIT = 50;
export const CANDIDATE_LIMIT = 200;
export const GRID_MARGIN_M = 1500;
export const CHECKIN_OPEN_BEFORE_MIN = 60;
export const CHECKIN_CLOSE_AFTER_DAYS = 7;

export const RL_REGISTER = { limit: 10, windowMs: 3_600_000 } as const;
export const RL_OPEN = { limit: 5, windowMs: 86_400_000 } as const;
export const RL_REPORT = { limit: 10, windowMs: 86_400_000 } as const;

export const TS_OPEN = "exchange_open";
export const TS_REGISTER = "exchange_register";
export const TS_REPORT = "exchange_report";

export type ExchangeEventStatus = (typeof EXCHANGE_EVENT_STATUSES)[number];
export type ExchangeRegStatus = (typeof EXCHANGE_REG_STATUSES)[number];
export type FeeMode = (typeof FEE_MODES)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
