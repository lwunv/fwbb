import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

export const admins = sqliteTable(
  "admins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    // Email đăng nhập/khôi phục (Phase 3 forgot-password). Nullable; unique qua
    // index riêng (KHÔNG .unique() inline → tránh recreate-table trên Turso).
    email: text("email"),
    phoneNumber: text("phone_number"),
    // Explicit pointer to the admin's own member record. Replaces the fragile
    // `members.name === admins.username` matching previously used to identify
    // admin's debts. Nullable so admins without a member row don't break.
    // FK ON DELETE SET NULL: if the linked member row is removed, the admin
    // row stays (admin auth lives on username/password, not memberId).
    memberId: integer("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [uniqueIndex("admins_email_unique").on(table.email)],
);

export const members = sqliteTable(
  "members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    nickname: text("nickname"),
    avatarKey: text("avatar_key"),
    /** Facebook user id. Nullable vì member có thể login bằng Google thay vì FB.
     *  Member tối thiểu phải có 1 trong {facebookId, googleId}. */
    facebookId: text("facebook_id").unique(),
    /** Google `sub` (user id) — set khi login bằng Google. */
    googleId: text("google_id").unique(),
    avatarUrl: text("avatar_url"),
    email: text("email").unique(),
    /** bcrypt hash. Optional — OAuth-only users không cần. Khi set, user có
     *  thể login bằng email + password (alternative cho SSO). */
    passwordHash: text("password_hash"),
    /** Số điện thoại (optional). User nhập khi đăng ký, dùng để liên hệ thanh
     *  toán nếu không match member admin tạo trước. KHÔNG unique (lịch sử có thể
     *  có 2 member cùng sđt liên hệ); login-by-phone chỉ nhận khi khớp đúng 1. */
    phoneNumber: text("phone_number"),
    /** Username tùy chọn cho login đa kênh. Lưu lowercase, unique (index
     *  `members_username_unique`). Nullable — member cũ chưa có; user tự đặt ở /me. */
    username: text("username"),
    /** Khi set + ở tương lai: `passwordHash` hiện tại là MẬT KHẨU TẠM do admin
     *  reset, hết hạn lúc này. Login bằng temp sau thời điểm này bị từ chối. */
    passwordResetExpiresAt: text("password_reset_expires_at"),
    /** true sau khi admin reset password → member bị bắt đặt mật khẩu mới ở gate
     *  trước khi dùng site. Clear khi đổi xong. */
    mustChangePassword: integer("must_change_password", { mode: "boolean" })
      .notNull()
      .default(false),
    bankAccountNo: text("bank_account_no").unique(),
    /** Trạng thái duyệt: "pending" = mới đăng ký, chưa được admin OK. "approved"
     *  = vào nhóm. "rejected" = admin từ chối, login lần sau vẫn chặn. Default
     *  "approved" để các row admin tạo trực tiếp đi qua mà không cần gì thêm —
     *  chỉ OAuth signup mới set "pending". */
    approvalStatus: text("approval_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("approved"),
    approvedAt: text("approved_at"),
    /** admin.id of approver. NULL cho row legacy (đã approved trước khi feature
     *  này tồn tại). */
    approvedBy: integer("approved_by"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** "Đi 2 người": acc này mặc định mỗi buổi đi 1 hay 2 người (vợ/chồng/bạn
     *  đi cùng). Snapshot vào votes.with_partner lúc vote; đổi đây KHÔNG hồi tố. */
    defaultWithPartner: integer("default_with_partner", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    // Username unique (lowercase lưu ở app layer). Dùng uniqueIndex thay vì
    // .unique() inline để drizzle sinh CREATE UNIQUE INDEX (ADD COLUMN an toàn,
    // KHÔNG recreate-table — Turso rớt index khi recreate).
    uniqueIndex("members_username_unique").on(table.username),
  ],
);

/**
 * Nhiều tài khoản đăng nhập ngoài (Google/Facebook) trỏ về CÙNG 1 member —
 * cho phép 1 người dùng 2+ tài khoản Google (hoặc thêm Facebook) cùng vào 1
 * hồ sơ. Cột legacy `members.googleId/facebookId` giữ lại làm identity CHÍNH
 * (được backfill vào bảng này); identity phụ chỉ nằm ở bảng này. Mọi lookup
 * đăng nhập SSO đi qua bảng này — xem `src/lib/oauth-identity.ts`.
 */
export const memberOauthIdentities = sqliteTable(
  "member_oauth_identities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "facebook"] }).notNull(),
    /** `sub` (Google) hoặc user id (Facebook) — định danh ổn định của provider. */
    providerUid: text("provider_uid").notNull(),
    /** Email tại thời điểm liên kết (thông tin, KHÔNG dùng để auth). */
    email: text("email"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    // 1 tài khoản provider chỉ liên kết vào TỐI ĐA 1 member (chặn account
    // takeover: không thể gắn 1 Google đang thuộc member khác).
    uniqueIndex("oauth_provider_uid_unique").on(
      table.provider,
      table.providerUid,
    ),
    index("oauth_member_id_idx").on(table.memberId),
  ],
);

export const courts = sqliteTable("courts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address"),
  /** Giá thuê lẻ — 220k/2h. Dùng khi thuê thêm sân ngoài hợp đồng tháng. */
  pricePerSessionRetail: integer("price_per_session_retail"),
  mapLink: text("map_link"),
  /** Giá thuê theo tháng — 200k/2h. (Cột `price_per_session` legacy: giá đang dùng = giá tháng). */
  pricePerSession: integer("price_per_session").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const shuttlecockBrands = sqliteTable("shuttlecock_brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  stockAdjustQua: integer("stock_adjust_qua").default(0),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    startTime: text("start_time").default("20:30"),
    endTime: text("end_time").default("22:30"),
    courtId: integer("court_id").references(() => courts.id, {
      onDelete: "set null",
    }),
    courtQuantity: integer("court_quantity").default(1),
    /**
     * Tổng tiền sân buổi này. NULL khi chưa chọn sân (session vừa tạo).
     * Sau khi `selectCourt` chạy, luôn ≥ 0 (computeCourtTotal trả non-negative)
     * hoặc bằng giá admin override (validate `moneyVnd ≥ 0` trong zod
     * `courtPriceOverrideSchema`). Không có CHECK constraint ở DB vì SQLite
     * ALTER TABLE không support ADD CHECK gọn — invariant này được giữ ở
     * app layer (mọi write path đều qua zod validate).
     */
    courtPrice: integer("court_price"),
    /**
     * Khi `true`, admin đã override `courtPrice` thủ công cho buổi này — các
     * action defensive-recompute (`selectCourt` đổi qty/sân, `confirmSession`)
     * sẽ giữ nguyên `courtPrice` thay vì tính lại theo formula. Reset về
     * `false` khi admin đổi sân hoặc số sân (intent đổi → quay lại auto).
     */
    courtPriceOverridden: integer("court_price_overridden", {
      mode: "boolean",
    }).default(false),
    /**
     * Min-deduction floor toggle. Khi `true`, `finalizeSession` sẽ apply
     * `applyMinDeductionFloor` cho mỗi member: nếu balance thiếu trả
     * playAmount AND playAmount < 60K → override lên 60K. Default `true`
     * — rule active mặc định cho session mới (admin có thể bỏ tick per
     * session để skip). Per-member exemption lưu ở
     * `sessionMinDeductionExemptions`. Xem
     * [[project-finance-balance-rules]] cho invariant + spec doc
     * `docs/superpowers/specs/2026-05-15-min-deduction-floor-design.md`.
     */
    useMinDeduction: integer("use_min_deduction", {
      mode: "boolean",
    }).default(true),
    status: text("status", {
      enum: ["voting", "confirmed", "completed", "cancelled"],
    }).default("voting"),
    diningBill: integer("dining_bill"),
    adminGuestPlayCount: integer("admin_guest_play_count").default(0),
    adminGuestDineCount: integer("admin_guest_dine_count").default(0),
    /** Số tiền pass sân (nếu admin hủy buổi và pass cho team khác).
     * Khi cancelled + passRevenue > 0 → admin đã thu được tiền và nộp vào quỹ. */
    passRevenue: integer("pass_revenue"),
    /**
     * Per-session vote deadline. NULL = no deadline (vote always open until
     * status changes). Default-filled at session creation as
     * `${date}T${startTime}:00` minus 4 hours. Format: ISO 8601 without `Z`
     * suffix, interpreted as Vietnam local time (matches `date` / `startTime`
     * convention). See docs/superpowers/specs/2026-05-21-vote-deadline-design.md.
     */
    voteDeadline: text("vote_deadline"),
    /** Sức chứa chơi cầu tối đa của buổi. Admin toggle 16 (mặc định) ⇄ 8.
     *  submitVote chặn vote play khi đủ; UI hiện "Hết slot"/"Còn N slot". */
    maxPlayers: integer("max_players").notNull().default(16),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    // UNIQUE on date — app logic giả định 1 session/ngày (cron + admin
    // createSessionManually đều check existing trước insert, nhưng race
    // không có UNIQUE → 2 admin trùng giây tạo 2 sessions/ngày → cost
    // calc + finalize bị duplicate aggregates).
    uniqueIndex("idx_sessions_date").on(table.date),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    willPlay: integer("will_play", { mode: "boolean" }).default(false),
    willDine: integer("will_dine", { mode: "boolean" }).default(false),
    guestPlayCount: integer("guest_play_count").default(0),
    guestDineCount: integer("guest_dine_count").default(0),
    /** Snapshot "đi 2 người" của phiếu này. true → member + người đi cùng = 2
     *  đầu (cả chơi lẫn nhậu, theo những mục member tham gia). Default theo
     *  members.default_with_partner lúc UI mở; ghi giá trị thật khi submit. */
    withPartner: integer("with_partner", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("votes_session_member_idx").on(table.sessionId, table.memberId),
  ],
);

export const sessionAttendees = sqliteTable("session_attendees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  memberId: integer("member_id").references(() => members.id, {
    onDelete: "set null",
  }),
  guestName: text("guest_name"),
  invitedById: integer("invited_by_id").references(() => members.id, {
    onDelete: "set null",
  }),
  isGuest: integer("is_guest", { mode: "boolean" }).default(false),
  /** Số đầu người attendee này đại diện ở phần CHƠI/NHẬU của CHÍNH họ. Member
   *  "đi 2 người" → 2. Guest luôn 1. Bất biến headcount ∈ {1,2} giữ ở app layer
   *  (zod) — KHÔNG thêm CHECK ở DB để migration là ADD COLUMN thuần (tránh
   *  recreate-table làm rớt index trên Turso; cùng cách courtPrice giữ invariant ở app). */
  headcount: integer("headcount").notNull().default(1),
  attendsPlay: integer("attends_play", { mode: "boolean" }).default(false),
  attendsDine: integer("attends_dine", { mode: "boolean" }).default(false),
});

export const sessionShuttlecocks = sqliteTable(
  "session_shuttlecocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    // brandId stays no-action: deleting a brand with historical usage would
    // lose the price snapshot needed for cost reconstruction.
    brandId: integer("brand_id")
      .notNull()
      .references(() => shuttlecockBrands.id),
    quantityUsed: integer("quantity_used").notNull(),
    pricePerTube: integer("price_per_tube").notNull(),
  },
  (table) => [
    // DB-level backstop for the app rule "quantityUsed ≥ 1" (recordPurchase /
    // addSessionShuttlecocks validate it; CHECK stops raw inserts too).
    check("session_shuttlecocks_qty_positive", sql`${table.quantityUsed} >= 1`),
  ],
);

export const inventoryPurchases = sqliteTable(
  "inventory_purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => shuttlecockBrands.id),
    tubes: integer("tubes").notNull(),
    pricePerTube: integer("price_per_tube").notNull(),
    totalPrice: integer("total_price").notNull(),
    purchasedAt: text("purchased_at").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    // DB-level backstop for "tubes ≥ 1" + non-negative money (recordPurchase
    // validates; CHECK stops raw inserts / future bugs from writing garbage).
    check("inventory_purchases_tubes_positive", sql`${table.tubes} >= 1`),
    check(
      "inventory_purchases_money_non_negative",
      sql`${table.pricePerTube} >= 0 AND ${table.totalPrice} >= 0`,
    ),
  ],
);

/**
 * Per-member exemption khỏi `min_deduction_floor` rule cho 1 session cụ thể.
 * Khi `sessions.use_min_deduction = true`, mặc định mọi member đều bị apply
 * rule; admin có thể tick để miễn từng người (insert 1 row vào đây). Vắng
 * row = member bị apply (default ON cho member).
 *
 * PK composite (session_id, member_id) chặn double-insert; `created_at`
 * giữ audit. KHÔNG có cờ "active/inactive" — admin un-untick = `DELETE`.
 */
export const sessionMinDeductionExemptions = sqliteTable(
  "session_min_deduction_exemptions",
  {
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("session_min_deduction_exemptions_pk").on(
      table.sessionId,
      table.memberId,
    ),
  ],
);

export const sessionMinDeductionExemptionsRelations = relations(
  sessionMinDeductionExemptions,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionMinDeductionExemptions.sessionId],
      references: [sessions.id],
    }),
    member: one(members, {
      fields: [sessionMinDeductionExemptions.memberId],
      references: [members.id],
    }),
  }),
);

export const sessionDebts = sqliteTable(
  "session_debts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    playAmount: integer("play_amount").default(0),
    dineAmount: integer("dine_amount").default(0),
    guestPlayAmount: integer("guest_play_amount").default(0),
    guestDineAmount: integer("guest_dine_amount").default(0),
    totalAmount: integer("total_amount").notNull(),
    memberConfirmed: integer("member_confirmed", { mode: "boolean" }).default(
      false,
    ),
    memberConfirmedAt: text("member_confirmed_at"),
    adminConfirmed: integer("admin_confirmed", { mode: "boolean" }).default(
      false,
    ),
    adminConfirmedAt: text("admin_confirmed_at"),
    updatedAt: text("updated_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("debts_session_member_idx").on(table.sessionId, table.memberId),
  ],
);

/**
 * Cặp member trùng tên đã được admin xác nhận KHÁC người → ẩn khỏi banner
 * "Phát hiện thành viên trùng tên". Lưu chuẩn hoá memberIdLow < memberIdHigh
 * nên mỗi cặp chỉ 1 dòng; unique index chặn ghi trùng. Xoá member nào thì
 * cascade xoá các cặp liên quan (không để lại FK trơ sau merge/delete).
 */
export const dupIgnoredPairs = sqliteTable(
  "dup_ignored_pairs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberIdLow: integer("member_id_low")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    memberIdHigh: integer("member_id_high")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("dup_ignored_pairs_low_high_idx").on(
      table.memberIdLow,
      table.memberIdHigh,
    ),
  ],
);

// Relations

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  court: one(courts, { fields: [sessions.courtId], references: [courts.id] }),
  votes: many(votes),
  attendees: many(sessionAttendees),
  shuttlecocks: many(sessionShuttlecocks),
  debts: many(sessionDebts),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  session: one(sessions, {
    fields: [votes.sessionId],
    references: [sessions.id],
  }),
  member: one(members, { fields: [votes.memberId], references: [members.id] }),
}));

export const sessionAttendeesRelations = relations(
  sessionAttendees,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionAttendees.sessionId],
      references: [sessions.id],
    }),
    member: one(members, {
      fields: [sessionAttendees.memberId],
      references: [members.id],
      relationName: "attendeeMember",
    }),
    invitedBy: one(members, {
      fields: [sessionAttendees.invitedById],
      references: [members.id],
      relationName: "invitedByMember",
    }),
  }),
);

export const sessionShuttlecocksRelations = relations(
  sessionShuttlecocks,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionShuttlecocks.sessionId],
      references: [sessions.id],
    }),
    brand: one(shuttlecockBrands, {
      fields: [sessionShuttlecocks.brandId],
      references: [shuttlecockBrands.id],
    }),
  }),
);

export const sessionDebtsRelations = relations(sessionDebts, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionDebts.sessionId],
    references: [sessions.id],
  }),
  member: one(members, {
    fields: [sessionDebts.memberId],
    references: [members.id],
  }),
}));

export const membersRelations = relations(members, ({ many }) => ({
  votes: many(votes),
  debts: many(sessionDebts),
  attendances: many(sessionAttendees, { relationName: "attendeeMember" }),
  guestsInvited: many(sessionAttendees, { relationName: "invitedByMember" }),
  financialTransactions: many(financialTransactions),
  oauthIdentities: many(memberOauthIdentities),
}));

export const memberOauthIdentitiesRelations = relations(
  memberOauthIdentities,
  ({ one }) => ({
    member: one(members, {
      fields: [memberOauthIdentities.memberId],
      references: [members.id],
    }),
  }),
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const courtsRelations = relations(courts, ({ many }) => ({
  sessions: many(sessions),
}));

export const shuttlecockBrandsRelations = relations(
  shuttlecockBrands,
  ({ many }) => ({
    sessionShuttlecocks: many(sessionShuttlecocks),
    purchases: many(inventoryPurchases),
  }),
);

export const inventoryPurchasesRelations = relations(
  inventoryPurchases,
  ({ one }) => ({
    brand: one(shuttlecockBrands, {
      fields: [inventoryPurchases.brandId],
      references: [shuttlecockBrands.id],
    }),
  }),
);

// ─── Fund (Quỹ nhóm) ───

// (removed) fund_members — roster quỹ giờ derive từ
// members.isActive=true AND approvalStatus='approved'. Xem fund-calculator.ts.

export const financialTransactions = sqliteTable(
  "financial_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", {
      enum: [
        "fund_contribution",
        "fund_deduction",
        "fund_refund",
        "debt_created",
        "debt_member_confirmed",
        "debt_admin_confirmed",
        "debt_undo",
        "inventory_purchase",
        "court_rent_payment",
        "manual_adjustment",
        "bank_payment_received",
        // Thu nhóm: tiền khách của admin trả (sàn 60K/khách) — vào quỹ chung,
        // memberId=null (không gắn balance ai). Đối xứng với court_rent_payment
        // (chi nhóm). KHÔNG thuộc nhóm fund_* nên không đụng invariant I1.
        "session_guest_income",
      ],
    }).notNull(),
    direction: text("direction", { enum: ["in", "out", "neutral"] }).notNull(),
    amount: integer("amount").notNull(),
    // All FKs SET NULL on parent delete — the ledger is an immutable audit
    // trail, so a deleted member/session/debt still leaves the transaction
    // row behind for historical reconstruction.
    memberId: integer("member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    sessionId: integer("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    debtId: integer("debt_id").references(() => sessionDebts.id, {
      onDelete: "set null",
    }),
    // FK to payment_notifications (was a bare integer). Reconcile I4 already
    // flags dangling refs at runtime; this enforces it at the DB. SET NULL —
    // the ledger row survives if the source notification is removed.
    paymentNotificationId: integer("payment_notification_id").references(
      (): AnySQLiteColumn => paymentNotifications.id,
      { onDelete: "set null" },
    ),
    inventoryPurchaseId: integer("inventory_purchase_id").references(
      () => inventoryPurchases.id,
      { onDelete: "set null" },
    ),
    // Self-FK: a reversal row points at the original it voids. Reconcile I9
    // flags orphan reversals at runtime; the DB FK (SET NULL) makes a dangling
    // reversalOfId impossible — load-bearing for the deleteSession / idempotent
    // finalize "already reversed?" guards.
    reversalOfId: integer("reversal_of_id").references(
      (): AnySQLiteColumn => financialTransactions.id,
      { onDelete: "set null" },
    ),
    description: text("description"),
    metadataJson: text("metadata_json"),
    /**
     * Idempotency key — NOT NULL since migration 0011. Caller-supplied keys
     * (UUID per logical action) make retries / double-submits coalesce into a
     * single transaction. UNIQUE so the second insert with the same key fails
     * at DB level — last line of defence under any race condition.
     *
     * DB default of `auto-${24 hex chars random}` covers callsites that don't
     * pass a key (legacy code, seed scripts, tests) — those rows get a unique
     * non-null key automatically so the invariant holds without forcing every
     * single insert call to supply a UUID. New money-touching code SHOULD
     * still pass an explicit key for true retry-safety. Legacy rows from
     * before migration 0011 carry `legacy-tx-${id}`.
     */
    idempotencyKey: text("idempotency_key")
      .notNull()
      .default(sql`('auto-' || lower(hex(randomblob(12))))`),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    index("idx_financial_transactions_member").on(table.memberId),
    index("idx_financial_transactions_session").on(table.sessionId),
    index("idx_financial_transactions_debt").on(table.debtId),
    index("idx_financial_transactions_type").on(table.type),
    // Hot-path balance query: filter by (memberId + type bucket) ordered by
    // createdAt. With only single-column indexes, SQLite picks one and
    // table-scans the rest — cost grows linearly with ledger size.
    index("idx_financial_transactions_member_type_created").on(
      table.memberId,
      table.type,
      table.createdAt,
    ),
    uniqueIndex("idx_financial_transactions_idempotency_key")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // Money is stored as a non-negative magnitude; `direction` (in/out/neutral)
    // carries the sign. recordFinancialTransaction + reconcile I5 enforce this
    // at the app layer — CHECK makes the DB reject any negative amount too.
    check(
      "financial_transactions_amount_non_negative",
      sql`${table.amount} >= 0`,
    ),
  ],
);

export const financialTransactionsRelations = relations(
  financialTransactions,
  ({ one }) => ({
    member: one(members, {
      fields: [financialTransactions.memberId],
      references: [members.id],
    }),
    session: one(sessions, {
      fields: [financialTransactions.sessionId],
      references: [sessions.id],
    }),
    debt: one(sessionDebts, {
      fields: [financialTransactions.debtId],
      references: [sessionDebts.id],
    }),
    inventoryPurchase: one(inventoryPurchases, {
      fields: [financialTransactions.inventoryPurchaseId],
      references: [inventoryPurchases.id],
    }),
  }),
);

// ─── Rate-limit buckets (DB-backed, multi-instance safe) ───
//
// Replaces the previous in-memory Map. On Vercel serverless each instance
// had its own bucket → attackers could amplify the limit by N instances.
// DB-backed buckets are global; SQLite serializes writers so the count is
// always correct under concurrent calls.

export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    /** Epoch millis when the bucket window expires. */
    resetAt: integer("reset_at").notNull(),
    updatedAt: text("updated_at").default(sql`(current_timestamp)`),
  },
  (table) => [index("idx_rate_limit_buckets_reset_at").on(table.resetAt)],
);

// ─── Payment Notifications (Gmail Pub/Sub) ───

export const paymentNotifications = sqliteTable("payment_notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gmailMessageId: text("gmail_message_id").notNull().unique(),
  senderBank: text("sender_bank"),
  amount: integer("amount"),
  transferContent: text("transfer_content"),
  senderAccountNo: text("sender_account_no"),
  matchedDebtId: integer("matched_debt_id").references(() => sessionDebts.id, {
    onDelete: "set null",
  }),
  // FK to financial_transactions — trước đây thiếu FK, dangling refs nếu
  // ledger row bị hard-deleted (vd court-rent reversal cũ). FK now enforced
  // at runtime via PRAGMA foreign_keys=ON; SET NULL preserves the
  // notification record even if the matched ledger row is reversed away.
  matchedTransactionId: integer("matched_transaction_id").references(
    () => financialTransactions.id,
    { onDelete: "set null" },
  ),
  status: text("status", {
    enum: ["pending", "matched", "ignored", "failed"],
  }).default("pending"),
  rawSnippet: text("raw_snippet"),
  receivedAt: text("received_at").default(sql`(current_timestamp)`),
});
