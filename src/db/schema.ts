import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Explicit pointer to the admin's own member record. Replaces the fragile
  // `members.name === admins.username` matching previously used to identify
  // admin's debts. Nullable so admins without a member row don't break.
  memberId: integer("member_id"),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const members = sqliteTable("members", {
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
  email: text("email"),
  /** Số điện thoại (optional). User nhập khi đăng ký, dùng để liên hệ thanh
   *  toán nếu không match member admin tạo trước. */
  phoneNumber: text("phone_number"),
  bankAccountNo: text("bank_account_no").unique(),
  /** Trạng thái duyệt: "pending" = mới đăng ký, chưa được admin OK. "approved"
   *  = vào nhóm. "rejected" = admin từ chối, login lần sau vẫn chặn. Default
   *  "approved" để các row admin tạo trực tiếp đi qua mà không cần gì thêm —
   *  chỉ OAuth signup mới set "pending". */
  approvalStatus: text("approval_status", {
    enum: ["pending", "approved", "rejected"],
  }).default("approved"),
  approvedAt: text("approved_at"),
  /** admin.id of approver. NULL cho row legacy (đã approved trước khi feature
   *  này tồn tại). */
  approvedBy: integer("approved_by"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

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
    courtId: integer("court_id").references(() => courts.id),
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
      .references(() => sessions.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
    willPlay: integer("will_play", { mode: "boolean" }).default(false),
    willDine: integer("will_dine", { mode: "boolean" }).default(false),
    guestPlayCount: integer("guest_play_count").default(0),
    guestDineCount: integer("guest_dine_count").default(0),
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
    .references(() => sessions.id),
  memberId: integer("member_id").references(() => members.id),
  guestName: text("guest_name"),
  invitedById: integer("invited_by_id").references(() => members.id),
  isGuest: integer("is_guest", { mode: "boolean" }).default(false),
  attendsPlay: integer("attends_play", { mode: "boolean" }).default(false),
  attendsDine: integer("attends_dine", { mode: "boolean" }).default(false),
});

export const sessionShuttlecocks = sqliteTable("session_shuttlecocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id),
  brandId: integer("brand_id")
    .notNull()
    .references(() => shuttlecockBrands.id),
  quantityUsed: integer("quantity_used").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
});

export const inventoryPurchases = sqliteTable("inventory_purchases", {
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
});

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
      .references(() => sessions.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
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
      .references(() => sessions.id),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id),
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

export const membersRelations = relations(members, ({ many, one }) => ({
  votes: many(votes),
  debts: many(sessionDebts),
  attendances: many(sessionAttendees, { relationName: "attendeeMember" }),
  guestsInvited: many(sessionAttendees, { relationName: "invitedByMember" }),
  fundMembership: one(fundMembers, {
    fields: [members.id],
    references: [fundMembers.memberId],
  }),
  financialTransactions: many(financialTransactions),
}));

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

export const fundMembers = sqliteTable("fund_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .unique()
    .references(() => members.id),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  joinedAt: text("joined_at").default(sql`(current_timestamp)`),
  leftAt: text("left_at"),
});

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
      ],
    }).notNull(),
    direction: text("direction", { enum: ["in", "out", "neutral"] }).notNull(),
    amount: integer("amount").notNull(),
    memberId: integer("member_id").references(() => members.id),
    sessionId: integer("session_id").references(() => sessions.id),
    debtId: integer("debt_id").references(() => sessionDebts.id),
    paymentNotificationId: integer("payment_notification_id"),
    inventoryPurchaseId: integer("inventory_purchase_id").references(
      () => inventoryPurchases.id,
    ),
    reversalOfId: integer("reversal_of_id"),
    description: text("description"),
    metadataJson: text("metadata_json"),
    /**
     * Optional idempotency key — set by client (UUID per logical action) so
     * retries / double-submits coalesce into a single transaction. UNIQUE so
     * the second insert with the same key fails at DB level (last line of
     * defence under any race condition).
     */
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [
    index("idx_financial_transactions_member").on(table.memberId),
    index("idx_financial_transactions_session").on(table.sessionId),
    index("idx_financial_transactions_debt").on(table.debtId),
    index("idx_financial_transactions_type").on(table.type),
    uniqueIndex("idx_financial_transactions_idempotency_key")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

export const fundMembersRelations = relations(fundMembers, ({ one }) => ({
  member: one(members, {
    fields: [fundMembers.memberId],
    references: [members.id],
  }),
}));

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
  matchedDebtId: integer("matched_debt_id").references(() => sessionDebts.id),
  // FK to financial_transactions — trước đây thiếu FK, dangling refs nếu
  // ledger row bị hard-deleted (vd court-rent reversal cũ). Schema thực thi
  // FK chỉ khi `PRAGMA foreign_keys=ON`, nhưng ít nhất ý định được khai báo.
  matchedTransactionId: integer("matched_transaction_id").references(
    () => financialTransactions.id,
  ),
  status: text("status", {
    enum: ["pending", "matched", "ignored", "failed"],
  }).default("pending"),
  rawSnippet: text("raw_snippet"),
  receivedAt: text("received_at").default(sql`(current_timestamp)`),
});
