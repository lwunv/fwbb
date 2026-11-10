// Hằng số G2d (uy tín, đánh giá sân, người giới thiệu, tín hiệu nick trùng).
// File thuần, không `server-only`: schema và component client đều import được.

export const PEER_TAGS = [
  "on_time",
  "friendly",
  "fair_play",
  "nice_play",
] as const;
export const VENUE_CRITERIA = [
  "surface",
  "lighting",
  "ventilation",
  "price",
  "parking",
  "owner",
] as const;
export const VENUE_REVIEW_STATUSES = ["visible", "held", "hidden"] as const;
export const REVIEW_HOLD_REASONS = ["contact", "banned", "anomaly"] as const;
export const IP_SIGNAL_KINDS = ["signup", "login", "register"] as const;

export type PeerTag = (typeof PEER_TAGS)[number];
export type VenueCriterion = (typeof VENUE_CRITERIA)[number];
export type VenueReviewStatus = (typeof VENUE_REVIEW_STATUSES)[number];
export type ReviewHoldReason = (typeof REVIEW_HOLD_REASONS)[number];
export type IpSignalKind = (typeof IP_SIGNAL_KINDS)[number];

/** Số buổi đã đến để lượt chấm nặng đủ 1 (`rater_weight` = 5, đơn vị 1/5). */
export const WEIGHT_FULL_AT = 5;
/** Số người chấm khác nhau tối thiểu để hiện một chỉ số. */
export const MIN_RATERS_SHOWN = 3;
/** Một buổi chỉ được cộng khi có ít nhất ngần này người chấm hợp lệ cho đúng đối tượng. */
export const MIN_RATERS_PER_EVENT = 3;
/**
 * Phần trăm host ("đúng mô tả", "đúng phí") nặng theo trọng số người chấm, mà
 * trọng số gần như công khai (số buổi đã đến). Với ít người chấm, mỗi tổ hợp
 * câu trả lời ra một số riêng nên host đọc ngược được ai trả lời gì. Vì vậy chỉ
 * hiện khi đủ ngần này người chấm khác nhau, và làm tròn xuống bậc `HOST_PCT_STEP`.
 */
export const HOST_PCT_MIN_RATERS = 5;
export const HOST_PCT_STEP = 10;
export const FEEDBACK_WINDOW_DAYS = 7;
export const FEEDBACK_MAX_PEERS = 50;
export const MAX_PEER_TAGS = 4;

export const VENUE_MIN_REVIEWS = 3;
export const BAYES_VIRTUAL_VOTES = 5;
export const REVIEW_COMMENT_MAX = 500;
export const REVIEW_EDIT_COOLDOWN_DAYS = 30;
export const REVIEW_DOUBLE_SUBMIT_MS = 60_000;
export const REVIEW_BURST_LIMIT = 5;
export const REVIEW_LOW_REP_BELOW = 3;
export const REVIEW_ANOMALY_MIN_TOTAL = 3;
export const REVIEW_ANOMALY_WINDOW_DAYS = 90;
export const REVIEW_REPORT_HIDE_THRESHOLD = 3;
export const REVIEW_PAGE_SIZE = 10;
export const REVIEW_MAX_OFFSET = 490;

export const HOST_FLAG_WINDOW_DAYS = 90;
export const HOST_FLAG_MIN_EVENTS = 3;
export const HOST_FLAG_SHARE_PCT = 80;
export const HOST_FLAG_MIN_CAPTIVES = 3;
export const HOST_FLAG_ROW_CAP = 5000;

export const REFERRAL_MIN_ATTENDED = 3;
export const REFERRAL_MIN_RATE_PCT = 80;
export const REFERRAL_MONTHLY_LIMIT = 5;
export const REFERRAL_WATCH_DAYS = 30;
export const REFERRAL_STRIKES = 2;
export const REFERRAL_BLOCK_DAYS = 30;

export const IP_SIGNAL_RETENTION_DAYS = 30;
export const IP_SIGNAL_PRUNE_BATCH = 200;
export const DUP_BURST_MIN = 3;
export const DUP_BURST_WINDOW_MS = 86_400_000;
export const DUP_SIGNAL_ROW_CAP = 5000;
/**
 * Cache banner tín hiệu nick trùng ở trang thành viên. Trang đó tự làm mới mỗi
 * 5 phút nên không được đọc lại bảng tín hiệu mỗi lượt (sự cố hạn mức 2/11).
 * Làm mới theo sự kiện: tín hiệu mới, "Bỏ qua", khoá/mở và gộp member; TTL chỉ
 * để bắt các đổi nhỏ còn lại (đổi tên, `last_seen_at`).
 */
export const DUP_SIGNALS_TAG = "dupsig";
export const DUP_SIGNALS_REVALIDATE_S = 3600;

export const RATING_REMINDER_DELAY_MS = 3_600_000;
export const RATING_JOB_KIND = "exchange_rate_reminder";

export const PROFILE_REVALIDATE_S = 600;
export const PRIOR_REVALIDATE_S = 3600;

export const RL_FEEDBACK = { limit: 20, windowMs: 3_600_000 } as const;
export const RL_REVIEW = { limit: 10, windowMs: 86_400_000 } as const;
export const RL_REFERRAL = { limit: 10, windowMs: 86_400_000 } as const;

export const TS_FEEDBACK = "exchange_feedback";
export const TS_REVIEW = "venue_review";
export const TS_REFERRAL = "exchange_referral";

/** Tag cache hồ sơ và uy tín của một member. */
export const repTag = (memberId: number): string => `rep:m${memberId}`;
/** Tag cache tổng điểm và trang đánh giá của một sân. */
export const venueReviewTag = (venueId: number): string => `vrev:v${venueId}`;
/** Trung bình chung mọi sân: chỉ revalidate theo giờ và khi ẩn/hiện sân. */
export const VENUE_REVIEWS_TAG = "vrev:all";
