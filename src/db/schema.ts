import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";

export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const courts = sqliteTable("courts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address"),
  mapLink: text("map_link"),
  pricePerSession: integer("price_per_session").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const shuttlecockBrands = sqliteTable("shuttlecock_brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  startTime: text("start_time").default("20:30"),
  endTime: text("end_time").default("22:30"),
  courtId: integer("court_id").references(() => courts.id),
  courtQuantity: integer("court_quantity").default(1),
  courtPrice: integer("court_price"),
  status: text("status", { enum: ["voting", "confirmed", "completed", "cancelled"] }).default("voting"),
  diningBill: integer("dining_bill"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  index("idx_sessions_date").on(table.date),
]);

export const votes = sqliteTable("votes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").notNull().references(() => members.id),
  willPlay: integer("will_play", { mode: "boolean" }).default(false),
  willDine: integer("will_dine", { mode: "boolean" }).default(false),
  guestPlayCount: integer("guest_play_count").default(0),
  guestDineCount: integer("guest_dine_count").default(0),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  uniqueIndex("votes_session_member_idx").on(table.sessionId, table.memberId),
]);

export const sessionAttendees = sqliteTable("session_attendees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").references(() => members.id),
  guestName: text("guest_name"),
  invitedById: integer("invited_by_id").references(() => members.id),
  isGuest: integer("is_guest", { mode: "boolean" }).default(false),
  attendsPlay: integer("attends_play", { mode: "boolean" }).default(false),
  attendsDine: integer("attends_dine", { mode: "boolean" }).default(false),
});

export const sessionShuttlecocks = sqliteTable("session_shuttlecocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  brandId: integer("brand_id").notNull().references(() => shuttlecockBrands.id),
  quantityUsed: integer("quantity_used").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
});

export const inventoryPurchases = sqliteTable("inventory_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brandId: integer("brand_id").notNull().references(() => shuttlecockBrands.id),
  tubes: integer("tubes").notNull(),
  pricePerTube: integer("price_per_tube").notNull(),
  totalPrice: integer("total_price").notNull(),
  purchasedAt: text("purchased_at").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});

export const sessionDebts = sqliteTable("session_debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  memberId: integer("member_id").notNull().references(() => members.id),
  playAmount: integer("play_amount").default(0),
  dineAmount: integer("dine_amount").default(0),
  guestPlayAmount: integer("guest_play_amount").default(0),
  guestDineAmount: integer("guest_dine_amount").default(0),
  totalAmount: integer("total_amount").notNull(),
  memberConfirmed: integer("member_confirmed", { mode: "boolean" }).default(false),
  memberConfirmedAt: text("member_confirmed_at"),
  adminConfirmed: integer("admin_confirmed", { mode: "boolean" }).default(false),
  adminConfirmedAt: text("admin_confirmed_at"),
  updatedAt: text("updated_at").default(sql`(current_timestamp)`),
}, (table) => [
  uniqueIndex("debts_session_member_idx").on(table.sessionId, table.memberId),
]);

// Relations

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  court: one(courts, { fields: [sessions.courtId], references: [courts.id] }),
  votes: many(votes),
  attendees: many(sessionAttendees),
  shuttlecocks: many(sessionShuttlecocks),
  debts: many(sessionDebts),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  session: one(sessions, { fields: [votes.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [votes.memberId], references: [members.id] }),
}));

export const sessionAttendeesRelations = relations(sessionAttendees, ({ one }) => ({
  session: one(sessions, { fields: [sessionAttendees.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [sessionAttendees.memberId], references: [members.id], relationName: "attendeeMember" }),
  invitedBy: one(members, { fields: [sessionAttendees.invitedById], references: [members.id], relationName: "invitedByMember" }),
}));

export const sessionShuttlecocksRelations = relations(sessionShuttlecocks, ({ one }) => ({
  session: one(sessions, { fields: [sessionShuttlecocks.sessionId], references: [sessions.id] }),
  brand: one(shuttlecockBrands, { fields: [sessionShuttlecocks.brandId], references: [shuttlecockBrands.id] }),
}));

export const sessionDebtsRelations = relations(sessionDebts, ({ one }) => ({
  session: one(sessions, { fields: [sessionDebts.sessionId], references: [sessions.id] }),
  member: one(members, { fields: [sessionDebts.memberId], references: [members.id] }),
}));

export const membersRelations = relations(members, ({ many }) => ({
  votes: many(votes),
  debts: many(sessionDebts),
  attendances: many(sessionAttendees, { relationName: "attendeeMember" }),
  guestsInvited: many(sessionAttendees, { relationName: "invitedByMember" }),
}));

export const courtsRelations = relations(courts, ({ many }) => ({
  sessions: many(sessions),
}));

export const shuttlecockBrandsRelations = relations(shuttlecockBrands, ({ many }) => ({
  sessionShuttlecocks: many(sessionShuttlecocks),
  purchases: many(inventoryPurchases),
}));

export const inventoryPurchasesRelations = relations(inventoryPurchases, ({ one }) => ({
  brand: one(shuttlecockBrands, { fields: [inventoryPurchases.brandId], references: [shuttlecockBrands.id] }),
}));
