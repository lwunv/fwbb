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
export const REPORT_TARGET_TYPES = [
  "member",
  "event",
  "comment",
  "review",
  "venue",
] as const;

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

export const COMMENT_CHANNELS = ["qa", "group"] as const;
export const COMMENT_STATUSES = [
  "visible",
  "held",
  "deleted",
  "hidden",
] as const;
export const COMMENT_SORTS = ["top", "new"] as const;

export const COMMENT_MAX_LEN = 1000;
export const COMMENT_EDIT_WINDOW_MS = 600_000;
export const COMMENT_PAGE_ROOTS = 10;
/** Trả lời tầng 1 mỗi gốc trong trang. */
export const COMMENT_PAGE_TIER1 = 2;
/** Trả lời tầng 2 mỗi tầng 1 trong trang. */
export const COMMENT_PAGE_TIER2 = 1;
/** Tầng 1 mỗi lần "Xem thêm trả lời" (kèm tối đa 4 tầng 2 mỗi cái). */
export const COMMENT_REPLIES_PAGE = 10;
export const COMMENT_MAX_ROWS = 50;
export const COMMENT_CHANNEL_CAP = 500;
export const COMMENT_REPORT_HIDE_THRESHOLD = 3;
export const COMMENT_OPEN_AFTER_END_DAYS = 7;
export const COMMENT_COUNT_WINDOW_DAYS = 14;
export const COMMENT_PASS_TTL_MS = 43_200_000;

export const RL_REGISTER = { limit: 10, windowMs: 3_600_000 } as const;
export const RL_OPEN = { limit: 5, windowMs: 86_400_000 } as const;
export const RL_REPORT = { limit: 10, windowMs: 86_400_000 } as const;

export const RL_COMMENT_BURST = { limit: 1, windowMs: 10_000 } as const;
export const RL_COMMENT_HOST = { limit: 20, windowMs: 60_000 } as const;
export const RL_COMMENT_DAY = { limit: 30, windowMs: 86_400_000 } as const;
export const RL_COMMENT_DAY_NEW = { limit: 5, windowMs: 86_400_000 } as const;
export const RL_COMMENT_EDIT = { limit: 10, windowMs: 60_000 } as const;
export const RL_COMMENT_VOTE = { limit: 60, windowMs: 3_600_000 } as const;
export const RL_COMMENT_MOD = { limit: 60, windowMs: 3_600_000 } as const;

export const TS_OPEN = "exchange_open";
export const TS_REGISTER = "exchange_register";
export const TS_REPORT = "exchange_report";
export const TS_COMMENT = "exchange_comment";

export type ExchangeEventStatus = (typeof EXCHANGE_EVENT_STATUSES)[number];
export type ExchangeRegStatus = (typeof EXCHANGE_REG_STATUSES)[number];
export type FeeMode = (typeof FEE_MODES)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type CommentChannel = (typeof COMMENT_CHANNELS)[number];
export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type CommentSort = (typeof COMMENT_SORTS)[number];
