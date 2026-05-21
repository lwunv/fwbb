-- FK ON DELETE retrofit + idempotency_key NOT NULL invariant.
--
-- Audit findings being addressed in this migration:
--
-- (#3, audit C1) Every FK was declared `ON DELETE no action`. With FK now
-- enforced at runtime (PRAGMA foreign_keys=ON in db/index.ts), any code path
-- that bypasses deleteSession/deleteMember leaves orphans. Retrofit:
--   - CASCADE for child rows owned by parent (votes, session_debts,
--     attendees, shuttlecocks, exemptions, fund_members).
--   - SET NULL for ledger refs and audit-preserving fields
--     (financial_transactions.{memberId,sessionId,debtId,inventoryPurchaseId},
--     payment_notifications.{matchedDebtId,matchedTransactionId},
--     admins.memberId, sessions.courtId, session_attendees.{memberId,invitedById}).
--
-- (#9, audit H1) `financial_transactions.idempotency_key` was nullable. The
-- partial UNIQUE index `WHERE idempotency_key IS NOT NULL` allowed any
-- caller passing NULL to bypass the "last line of defence" guard from
-- AGENTS.md. Backfill legacy rows with `legacy-tx-${id}` then enforce
-- NOT NULL.
--
-- (#10) `sessions.use_min_deduction` schema default = true but migration 0006
-- defaulted to false. New sessions inserted via Drizzle pick up the schema
-- default; raw SQL inserts (seed, manual queries) silently picked up false.
-- Recreate-table aligns the column default with the schema.
--
-- Pattern: SQLite has no direct `ALTER COLUMN <add FK>`. Each retrofit uses
-- the standard recreate-table dance: CREATE __new_<table>, INSERT SELECT,
-- DROP old, RENAME, then recreate indexes. PRAGMA foreign_keys=OFF for the
-- duration so the inserts don't trip over already-present rows referencing
-- soon-to-be-renamed tables.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- ─── Backfill: idempotency_key NULLs ───
-- Stable per-row natural key. Legacy rows kept distinguishable via prefix
-- so a future audit can still pick them out vs. real client-supplied keys.
UPDATE `financial_transactions`
   SET `idempotency_key` = 'legacy-tx-' || `id`
 WHERE `idempotency_key` IS NULL;
--> statement-breakpoint

-- ─── admins: add memberId FK (was bare integer) ───
CREATE TABLE `__new_admins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `member_id` integer,
  `created_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_admins` (id, username, password_hash, member_id, created_at)
  SELECT id, username, password_hash, member_id, created_at FROM `admins`;
--> statement-breakpoint
DROP TABLE `admins`;
--> statement-breakpoint
ALTER TABLE `__new_admins` RENAME TO `admins`;
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);
--> statement-breakpoint

-- ─── sessions: courtId FK SET NULL + useMinDeduction default true ───
CREATE TABLE `__new_sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `start_time` text DEFAULT '20:30',
  `end_time` text DEFAULT '22:30',
  `court_id` integer,
  `court_quantity` integer DEFAULT 1,
  `court_price` integer,
  `court_price_overridden` integer DEFAULT false,
  `use_min_deduction` integer DEFAULT true,
  `status` text DEFAULT 'voting',
  `dining_bill` integer,
  `admin_guest_play_count` integer DEFAULT 0,
  `admin_guest_dine_count` integer DEFAULT 0,
  `pass_revenue` integer,
  `notes` text,
  `created_at` text DEFAULT (current_timestamp),
  `updated_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_sessions`
  (id, date, start_time, end_time, court_id, court_quantity, court_price,
   court_price_overridden, use_min_deduction, status, dining_bill,
   admin_guest_play_count, admin_guest_dine_count, pass_revenue, notes,
   created_at, updated_at)
SELECT
  id, date, start_time, end_time, court_id, court_quantity, court_price,
  court_price_overridden, use_min_deduction, status, dining_bill,
  admin_guest_play_count, admin_guest_dine_count, pass_revenue, notes,
  created_at, updated_at
FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_date` ON `sessions` (`date`);
--> statement-breakpoint

-- ─── votes: both FKs CASCADE ───
CREATE TABLE `__new_votes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` integer NOT NULL,
  `member_id` integer NOT NULL,
  `will_play` integer DEFAULT false,
  `will_dine` integer DEFAULT false,
  `guest_play_count` integer DEFAULT 0,
  `guest_dine_count` integer DEFAULT 0,
  `created_at` text DEFAULT (current_timestamp),
  `updated_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_votes`
  (id, session_id, member_id, will_play, will_dine, guest_play_count,
   guest_dine_count, created_at, updated_at)
SELECT
  id, session_id, member_id, will_play, will_dine, guest_play_count,
  guest_dine_count, created_at, updated_at
FROM `votes`;
--> statement-breakpoint
DROP TABLE `votes`;
--> statement-breakpoint
ALTER TABLE `__new_votes` RENAME TO `votes`;
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_session_member_idx` ON `votes` (`session_id`, `member_id`);
--> statement-breakpoint

-- ─── session_attendees: sessionId CASCADE, member/invitedBy SET NULL ───
CREATE TABLE `__new_session_attendees` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` integer NOT NULL,
  `member_id` integer,
  `guest_name` text,
  `invited_by_id` integer,
  `is_guest` integer DEFAULT false,
  `attends_play` integer DEFAULT false,
  `attends_dine` integer DEFAULT false,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`invited_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_session_attendees`
  (id, session_id, member_id, guest_name, invited_by_id, is_guest,
   attends_play, attends_dine)
SELECT
  id, session_id, member_id, guest_name, invited_by_id, is_guest,
  attends_play, attends_dine
FROM `session_attendees`;
--> statement-breakpoint
DROP TABLE `session_attendees`;
--> statement-breakpoint
ALTER TABLE `__new_session_attendees` RENAME TO `session_attendees`;
--> statement-breakpoint

-- ─── session_shuttlecocks: sessionId CASCADE, brandId no action ───
-- brandId stays no-action: deleting a brand with historical usage would lose
-- the price snapshot needed for cost reconstruction. Admin must reassign
-- usage first.
CREATE TABLE `__new_session_shuttlecocks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` integer NOT NULL,
  `brand_id` integer NOT NULL,
  `quantity_used` integer NOT NULL,
  `price_per_tube` integer NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`brand_id`) REFERENCES `shuttlecock_brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_shuttlecocks`
  (id, session_id, brand_id, quantity_used, price_per_tube)
SELECT id, session_id, brand_id, quantity_used, price_per_tube
FROM `session_shuttlecocks`;
--> statement-breakpoint
DROP TABLE `session_shuttlecocks`;
--> statement-breakpoint
ALTER TABLE `__new_session_shuttlecocks` RENAME TO `session_shuttlecocks`;
--> statement-breakpoint

-- ─── session_debts: both CASCADE ───
CREATE TABLE `__new_session_debts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` integer NOT NULL,
  `member_id` integer NOT NULL,
  `play_amount` integer DEFAULT 0,
  `dine_amount` integer DEFAULT 0,
  `guest_play_amount` integer DEFAULT 0,
  `guest_dine_amount` integer DEFAULT 0,
  `total_amount` integer NOT NULL,
  `member_confirmed` integer DEFAULT false,
  `member_confirmed_at` text,
  `admin_confirmed` integer DEFAULT false,
  `admin_confirmed_at` text,
  `updated_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_debts`
  (id, session_id, member_id, play_amount, dine_amount, guest_play_amount,
   guest_dine_amount, total_amount, member_confirmed, member_confirmed_at,
   admin_confirmed, admin_confirmed_at, updated_at)
SELECT
  id, session_id, member_id, play_amount, dine_amount, guest_play_amount,
  guest_dine_amount, total_amount, member_confirmed, member_confirmed_at,
  admin_confirmed, admin_confirmed_at, updated_at
FROM `session_debts`;
--> statement-breakpoint
DROP TABLE `session_debts`;
--> statement-breakpoint
ALTER TABLE `__new_session_debts` RENAME TO `session_debts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `debts_session_member_idx` ON `session_debts` (`session_id`, `member_id`);
--> statement-breakpoint

-- ─── session_min_deduction_exemptions: both CASCADE ───
CREATE TABLE `__new_session_min_deduction_exemptions` (
  `session_id` integer NOT NULL,
  `member_id` integer NOT NULL,
  `created_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_min_deduction_exemptions` (session_id, member_id, created_at)
  SELECT session_id, member_id, created_at FROM `session_min_deduction_exemptions`;
--> statement-breakpoint
DROP TABLE `session_min_deduction_exemptions`;
--> statement-breakpoint
ALTER TABLE `__new_session_min_deduction_exemptions` RENAME TO `session_min_deduction_exemptions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `session_min_deduction_exemptions_pk` ON `session_min_deduction_exemptions` (`session_id`, `member_id`);
--> statement-breakpoint

-- ─── fund_members: memberId CASCADE ───
CREATE TABLE `__new_fund_members` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `member_id` integer NOT NULL,
  `is_active` integer DEFAULT true,
  `joined_at` text DEFAULT (current_timestamp),
  `left_at` text,
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fund_members` (id, member_id, is_active, joined_at, left_at)
  SELECT id, member_id, is_active, joined_at, left_at FROM `fund_members`;
--> statement-breakpoint
DROP TABLE `fund_members`;
--> statement-breakpoint
ALTER TABLE `__new_fund_members` RENAME TO `fund_members`;
--> statement-breakpoint
CREATE UNIQUE INDEX `fund_members_member_id_unique` ON `fund_members` (`member_id`);
--> statement-breakpoint

-- ─── financial_transactions: SET NULL on all FK refs + idempotency_key NOT NULL ───
-- All FKs SET NULL because the ledger is an immutable audit trail: a deleted
-- member's transactions still record what happened, just with a nullable
-- pointer. This matches the deleteSession path which already NULLs refs
-- before deleting the parent.
CREATE TABLE `__new_financial_transactions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `direction` text NOT NULL,
  `amount` integer NOT NULL,
  `member_id` integer,
  `session_id` integer,
  `debt_id` integer,
  `payment_notification_id` integer,
  `inventory_purchase_id` integer,
  `reversal_of_id` integer,
  `description` text,
  `metadata_json` text,
  `idempotency_key` text NOT NULL DEFAULT ('auto-' || lower(hex(randomblob(12)))),
  `created_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`debt_id`) REFERENCES `session_debts`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`inventory_purchase_id`) REFERENCES `inventory_purchases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_financial_transactions`
  (id, type, direction, amount, member_id, session_id, debt_id,
   payment_notification_id, inventory_purchase_id, reversal_of_id,
   description, metadata_json, idempotency_key, created_at)
SELECT
  id, type, direction, amount, member_id, session_id, debt_id,
  payment_notification_id, inventory_purchase_id, reversal_of_id,
  description, metadata_json, idempotency_key, created_at
FROM `financial_transactions`;
--> statement-breakpoint
DROP TABLE `financial_transactions`;
--> statement-breakpoint
ALTER TABLE `__new_financial_transactions` RENAME TO `financial_transactions`;
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_member` ON `financial_transactions` (`member_id`);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_debt` ON `financial_transactions` (`debt_id`);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_type` ON `financial_transactions` (`type`);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_member_type_created`
  ON `financial_transactions` (`member_id`, `type`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_financial_transactions_idempotency_key`
  ON `financial_transactions` (`idempotency_key`)
  WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint

-- ─── payment_notifications: matchedDebtId + matchedTransactionId SET NULL ───
CREATE TABLE `__new_payment_notifications` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `gmail_message_id` text NOT NULL,
  `sender_bank` text,
  `amount` integer,
  `transfer_content` text,
  `sender_account_no` text,
  `matched_debt_id` integer,
  `matched_transaction_id` integer,
  `status` text DEFAULT 'pending',
  `raw_snippet` text,
  `received_at` text DEFAULT (current_timestamp),
  FOREIGN KEY (`matched_debt_id`) REFERENCES `session_debts`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`matched_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_payment_notifications`
  (id, gmail_message_id, sender_bank, amount, transfer_content,
   sender_account_no, matched_debt_id, matched_transaction_id, status,
   raw_snippet, received_at)
SELECT
  id, gmail_message_id, sender_bank, amount, transfer_content,
  sender_account_no, matched_debt_id, matched_transaction_id, status,
  raw_snippet, received_at
FROM `payment_notifications`;
--> statement-breakpoint
DROP TABLE `payment_notifications`;
--> statement-breakpoint
ALTER TABLE `__new_payment_notifications` RENAME TO `payment_notifications`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_notifications_gmail_message_id_unique`
  ON `payment_notifications` (`gmail_message_id`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
