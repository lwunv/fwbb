/**
 * Danh mục thông báo: nguồn duy nhất cho "kind nào tồn tại, gửi cho ai, có tắt
 * được không, có email không, gửi lúc nào" (spec 4.5). Gửi, hiển thị, email và
 * trang cài đặt đều đọc từ đây, nên thêm kind mới chỉ sửa một chỗ.
 */

export type NotificationGroup =
  | "session"
  | "money"
  | "account"
  | "venue"
  | "exchange"
  | "exchange_comments"
  | "admin_session"
  | "admin_money"
  | "admin_members"
  | "admin_inventory";

export const MEMBER_GROUPS = [
  "session",
  "money",
  "account",
  "venue",
  "exchange",
  "exchange_comments",
] as const satisfies readonly NotificationGroup[];

export const ADMIN_GROUPS = [
  "admin_session",
  "admin_money",
  "admin_members",
  "admin_inventory",
] as const satisfies readonly NotificationGroup[];

export interface KindDef {
  audience: "member" | "admin";
  group: NotificationGroup;
  /** Bắt buộc: member không tắt được (tiền, tài khoản, đổi lịch). */
  mandatory: boolean;
  email: boolean;
  /** now = gửi ngay; scheduled = job hẹn giờ; digest = gom vào tóm tắt. */
  level: "now" | "scheduled" | "digest";
  /** Vượt giờ yên lặng khi buổi chơi diễn ra trong ngày. */
  quietHoursBypassSameDay: boolean;
}

/** Trường chung của tin gắn với một buổi: `YYYY-MM-DD` và `HH:MM`. */
interface SessionWhen {
  sessionDate: string;
  startTime: string;
}

/** Các khoản tiền buổi của một member trong tin chốt sổ (VND). */
interface SessionAmounts {
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
  guestToFund: number;
  total: number;
  balance: number;
}

/**
 * Payload mỗi kind. Chỉ chứa giá trị JSON phẳng (string, number, boolean, null,
 * string[]). Tiền là số nguyên VND.
 */
export interface NotificationPayloads {
  session_opened: SessionWhen;
  /** Số giờ nguyên còn tới hạn vote lúc gửi (≥ 1), không phải mốc của job. */
  vote_due_soon: SessionWhen & { hoursLeft: number };
  /** Hạn vote mới (giờ VN, `YYYY-MM-DDTHH:MM:SS`); null = không có hạn. */
  vote_reopened: SessionWhen & { voteDeadline: string | null };
  /** Vote MỚI của chính member (xoá vote thì tất cả false / 0). */
  vote_edited_by_admin: SessionWhen & {
    willPlay: boolean;
    willDine: boolean;
    withPartner: boolean;
    guestPlayCount: number;
    guestDineCount: number;
  };
  /** Giá trị SAU khi đổi; `courtPrice` là tổng tiền sân (VND). */
  session_changed: SessionWhen & {
    fields: ("time" | "court" | "price")[];
    endTime: string;
    courtName: string | null;
    courtPrice: number | null;
  };
  session_cancelled: SessionWhen;
  session_reopened: SessionWhen;
  session_almost_full: SessionWhen;
  game_day_reminder: SessionWhen & {
    when: "morning" | "3h";
    courtName: string;
    /** Chỉ có khi sân có link bản đồ. */
    mapLink?: string;
  };
  /**
   * Khoản của CHÍNH member theo dòng `session_debts` vừa ghi. `total` là số bị
   * trừ khỏi số dư; với member gắn admin, tiền khách của admin không trừ vào
   * admin mà vào quỹ chung (`guestToFund`), các ô khách để 0. `balance` là số
   * dư sau khi ghi sổ.
   */
  session_finalized: SessionWhen & SessionAmounts;
  /** `total` là tổng mới (0 khi bị bỏ khỏi buổi), `oldTotal` là tổng đã báo trước. */
  session_amount_changed: SessionWhen & SessionAmounts & { oldTotal: number };
  /** `amount` = thay đổi số dư do xoá buổi (âm khi tiền pass bị rút lại). */
  session_deleted_refund: SessionWhen & { amount: number; balance: number };
  /*
   * Ba kind dưới KHÔNG có `balance`: action của chúng có nhánh chạy
   * autoApplyFundToDebts SAU transaction, nên số dư đọc trong tx có thể khác
   * số member thấy ở /my-fund (plan N1, Review Focus 4).
   */
  payment_confirmed: { amount: number };
  payment_undone: { amount: number; balance: number; reason: string };
  transaction_reversed: { amount: number; reason: string };
  fund_contribution_recorded: { amount: number };
  fund_refund_recorded: { amount: number; balance: number };
  debt_reminder: { amount: number; days: number };
  account_approved: Record<string, never>;
  account_rejected: Record<string, never>;
  group_request_declined: Record<string, never>;
  account_merged: Record<string, never>;
  password_changed: { byAdmin?: boolean };
  login_method_linked: { provider: string };
  login_method_unlinked: { provider: string };
  venue_approved: { venueName: string };
  venue_hidden: { venueName: string };
  /** rank 1 = sắp đầy, 2 = đầy, 3+ = vượt sức chứa; `courtLockAt` là ISO UTC. */
  capacity_alert: SessionWhen & {
    rank: number;
    headcount: number;
    maxPlayers: number;
    courtLockAt: string;
  };
  low_attendance: SessionWhen & { headcount: number; maxPlayers: number };
  /** `headcount` = số người chơi còn lại sau khi bỏ. */
  member_dropped_late: SessionWhen & {
    memberName: string;
    headcount: number;
    maxPlayers: number;
  };
  unvoted_before_deadline: SessionWhen & {
    names: string[];
    /** Hạn vote (giờ VN, `YYYY-MM-DDTHH:MM:SS`); null = không có hạn. */
    voteDeadline: string | null;
  };
  /** `sessionDate` chỉ có khi `purpose` là "debt". */
  member_reported_transfer: {
    memberName: string;
    amount: number;
    purpose: "debt" | "fund";
    sessionDate?: string;
  };
  signup_pending: { memberName: string; provider?: string };
  group_join_request: { memberName: string };
  venue_pending: { venueName: string; proposerName: string };
  low_stock: { brandName: string; stockQua: number };
  court_rent_unpaid: { month: string; amount: number };
  reconcile_failed: { errorCount: number };
  weekly_summary: {
    /** Tổng số người nợ quá 30 ngày (có thể nhiều hơn danh sách `debtors`). */
    debtorCount: number;
    upcomingCount: number;
    pendingCount: number;
    /**
     * Tối đa 20 người nợ lâu, nợ nhiều nhất trước; `amount` là VND nguyên đang
     * nợ. Tin chỉ cho superadmin nên được có tên. Job tạo trước bản này không có.
     */
    debtors?: { name: string; amount: number }[];
  };
  /**
   * Tin giao lưu (G2b). Tin gửi host chỉ có SỐ NGƯỜI (`heads`), không tên và
   * không tiền của ai; tin gửi người đăng ký chỉ có khoản của chính họ.
   */
  exchange_registration_received: ExchangeEventRef & {
    heads: number;
    needsApproval: boolean;
  };
  exchange_registration_cancelled: ExchangeEventRef & {
    heads: number;
    late: boolean;
  };
  exchange_cancelled_after_lock: ExchangeEventRef & {
    heads: number;
    late: boolean;
  };
  exchange_registration_approved: ExchangeEventRef & { startAt: string };
  exchange_registration_rejected: ExchangeEventRef & {
    startAt: string;
    refundDue: number;
  };
  exchange_waitlist_promoted: ExchangeEventRef & {
    startAt: string;
    status: "pending" | "approved";
  };
  exchange_fee_locked: ExchangeFee;
  /** `amount` = 0 khi người đó không còn bị tính phí. */
  exchange_fee_changed: ExchangeFee & { previousAmount: number };
  exchange_event_cancelled: ExchangeEventRef & {
    startAt: string;
    refundDue: number;
  };
  exchange_event_hidden: ExchangeEventRef;
  /** Mã đối tượng và lý do (dịch lúc hiển thị), không có tên ai. */
  exchange_reported: { targetType: string; reason: string };
  /**
   * Tin bình luận (G2c), chỉ chuông. Payload không có tên và không có nội dung
   * bình luận: người đọc mở trang để xem.
   */
  exchange_comment_new: ExchangeEventRef & { channel: "qa" | "group" };
  exchange_comment_reply: ExchangeEventRef & { channel: "qa" | "group" };
  exchange_comment_host_post: ExchangeEventRef;
  exchange_comment_held: ExchangeEventRef;
  /**
   * Đánh giá sân vào hàng chờ (G2d). Chỉ tên sân: không người viết, không
   * nội dung; admin mở tab Uy tín để xem.
   */
  venue_review_held: { venueName: string };
}

/** Trường chung của tin giao lưu: mã URL công khai và tên buổi. */
interface ExchangeEventRef {
  eventCode: string;
  eventTitle: string;
}

/** Khoản của CHÍNH member khi host chốt phí (VND nguyên). */
type ExchangeFee = ExchangeEventRef & {
  /** ISO UTC. */
  startAt: string;
  amount: number;
  deposit: number;
  /** Còn phải trả sau khi trừ cọc. */
  remaining: number;
  /** Cọc dư được hoàn. */
  refundDue: number;
  aboveEstimate: boolean;
};

export type NotificationKind = keyof NotificationPayloads;

function def(
  audience: KindDef["audience"],
  group: NotificationGroup,
  mandatory: boolean,
  email: boolean,
  level: KindDef["level"],
  bypass = false,
): KindDef {
  return {
    audience,
    group,
    mandatory,
    email,
    level,
    quietHoursBypassSameDay: bypass,
  };
}

export const NOTIFICATION_CATALOG: Record<NotificationKind, KindDef> = {
  // Member, buổi chơi
  session_opened: def("member", "session", false, false, "now"),
  vote_due_soon: def("member", "session", false, true, "scheduled"),
  vote_reopened: def("member", "session", false, false, "now"),
  vote_edited_by_admin: def("member", "session", true, false, "now"),
  session_changed: def("member", "session", true, true, "now", true),
  session_cancelled: def("member", "session", true, true, "now", true),
  session_reopened: def("member", "session", true, false, "now"),
  session_almost_full: def("member", "session", false, false, "now"),
  game_day_reminder: def("member", "session", false, false, "scheduled"),
  // Member, tiền
  session_finalized: def("member", "money", true, true, "now"),
  session_amount_changed: def("member", "money", true, true, "now"),
  session_deleted_refund: def("member", "money", true, true, "now"),
  payment_confirmed: def("member", "money", true, true, "now"),
  payment_undone: def("member", "money", true, true, "now"),
  transaction_reversed: def("member", "money", true, true, "now"),
  fund_contribution_recorded: def("member", "money", true, true, "now"),
  fund_refund_recorded: def("member", "money", true, true, "now"),
  debt_reminder: def("member", "money", true, true, "scheduled"),
  // Member, tài khoản
  account_approved: def("member", "account", true, true, "now"),
  account_rejected: def("member", "account", true, true, "now"),
  group_request_declined: def("member", "account", true, true, "now"),
  account_merged: def("member", "account", true, true, "now"),
  password_changed: def("member", "account", true, true, "now"),
  login_method_linked: def("member", "account", true, true, "now"),
  login_method_unlinked: def("member", "account", true, true, "now"),
  // Member, sân mình đề xuất
  venue_approved: def("member", "venue", false, true, "digest"),
  venue_hidden: def("member", "venue", false, true, "digest"),
  // Member, giao lưu (cờ `exchangeEnabled` quyết định có hiện nhóm này ở cài đặt)
  exchange_registration_received: def(
    "member",
    "exchange",
    false,
    false,
    "now",
  ),
  exchange_registration_cancelled: def(
    "member",
    "exchange",
    false,
    false,
    "now",
  ),
  exchange_cancelled_after_lock: def("member", "exchange", true, false, "now"),
  exchange_registration_approved: def("member", "exchange", true, true, "now"),
  exchange_registration_rejected: def("member", "exchange", true, false, "now"),
  exchange_waitlist_promoted: def("member", "exchange", true, true, "now"),
  exchange_fee_locked: def("member", "exchange", true, true, "now"),
  exchange_fee_changed: def("member", "exchange", true, true, "now"),
  exchange_event_cancelled: def("member", "exchange", true, true, "now", true),
  exchange_event_hidden: def("member", "exchange", true, false, "now"),
  // Member, bình luận giao lưu (chỉ chuông, tắt được theo nhóm)
  exchange_comment_new: def("member", "exchange_comments", false, false, "now"),
  exchange_comment_reply: def(
    "member",
    "exchange_comments",
    false,
    false,
    "now",
  ),
  exchange_comment_host_post: def(
    "member",
    "exchange_comments",
    false,
    false,
    "now",
  ),
  exchange_comment_held: def(
    "member",
    "exchange_comments",
    false,
    false,
    "now",
  ),
  // Admin
  exchange_reported: def("admin", "admin_members", false, false, "now"),
  venue_review_held: def("admin", "admin_members", false, false, "now"),
  capacity_alert: def("admin", "admin_session", true, true, "now"),
  low_attendance: def("admin", "admin_session", true, true, "scheduled"),
  member_dropped_late: def("admin", "admin_session", false, false, "now"),
  unvoted_before_deadline: def(
    "admin",
    "admin_session",
    false,
    false,
    "scheduled",
  ),
  member_reported_transfer: def("admin", "admin_money", false, false, "now"),
  signup_pending: def("admin", "admin_members", false, false, "now"),
  group_join_request: def("admin", "admin_members", false, false, "now"),
  venue_pending: def("admin", "admin_members", true, true, "now"),
  low_stock: def("admin", "admin_inventory", false, false, "now"),
  court_rent_unpaid: def("admin", "admin_money", false, true, "scheduled"),
  reconcile_failed: def("admin", "admin_money", true, true, "now"),
  weekly_summary: def("admin", "admin_session", false, true, "scheduled"),
};

/**
 * Nhóm tắt được khi còn ít nhất 1 kind không bắt buộc. Nhóm toàn kind bắt buộc
 * (vd "account") không có công tắc: tin quan trọng luôn được gửi.
 */
export function isGroupMutable(group: NotificationGroup): boolean {
  return Object.values(NOTIFICATION_CATALOG).some(
    (def) => def.group === group && !def.mandatory,
  );
}

export const NOTIFICATION_KINDS = Object.keys(
  NOTIFICATION_CATALOG,
) as NotificationKind[];

export function isNotificationKind(value: string): value is NotificationKind {
  return Object.hasOwn(NOTIFICATION_CATALOG, value);
}
