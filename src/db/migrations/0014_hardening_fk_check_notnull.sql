DROP INDEX "admins_username_unique";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_member";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_session";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_debt";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_type";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_member_type_created";--> statement-breakpoint
DROP INDEX "idx_financial_transactions_idempotency_key";--> statement-breakpoint
DROP INDEX "members_facebook_id_unique";--> statement-breakpoint
DROP INDEX "members_google_id_unique";--> statement-breakpoint
DROP INDEX "members_email_unique";--> statement-breakpoint
DROP INDEX "members_bank_account_no_unique";--> statement-breakpoint
DROP INDEX "payment_notifications_gmail_message_id_unique";--> statement-breakpoint
DROP INDEX "idx_rate_limit_buckets_reset_at";--> statement-breakpoint
DROP INDEX "debts_session_member_idx";--> statement-breakpoint
DROP INDEX "session_min_deduction_exemptions_pk";--> statement-breakpoint
DROP INDEX "idx_sessions_date";--> statement-breakpoint
DROP INDEX "votes_session_member_idx";--> statement-breakpoint
ALTER TABLE `members` ALTER COLUMN "approval_status" TO "approval_status" text NOT NULL DEFAULT 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_facebook_id_unique` ON `members` (`facebook_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_google_id_unique` ON `members` (`google_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_bank_account_no_unique` ON `members` (`bank_account_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_notifications_gmail_message_id_unique` ON `payment_notifications` (`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `idx_rate_limit_buckets_reset_at` ON `rate_limit_buckets` (`reset_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `debts_session_member_idx` ON `session_debts` (`session_id`,`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_min_deduction_exemptions_pk` ON `session_min_deduction_exemptions` (`session_id`,`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_date` ON `sessions` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `votes_session_member_idx` ON `votes` (`session_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `members` ALTER COLUMN "is_active" TO "is_active" integer NOT NULL DEFAULT true;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`idempotency_key` text DEFAULT ('auto-' || lower(hex(randomblob(12)))) NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`debt_id`) REFERENCES `session_debts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_notification_id`) REFERENCES `payment_notifications`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inventory_purchase_id`) REFERENCES `inventory_purchases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "financial_transactions_amount_non_negative" CHECK("__new_financial_transactions"."amount" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_financial_transactions`("id", "type", "direction", "amount", "member_id", "session_id", "debt_id", "payment_notification_id", "inventory_purchase_id", "reversal_of_id", "description", "metadata_json", "idempotency_key", "created_at") SELECT "id", "type", "direction", "amount", "member_id", "session_id", "debt_id", "payment_notification_id", "inventory_purchase_id", "reversal_of_id", "description", "metadata_json", "idempotency_key", "created_at" FROM `financial_transactions`;--> statement-breakpoint
DROP TABLE `financial_transactions`;--> statement-breakpoint
ALTER TABLE `__new_financial_transactions` RENAME TO `financial_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Recreate financial_transactions indexes AFTER the table recreate. drizzle-kit
-- emitted these before the DROP+RENAME above, so they would have been lost with
-- the old table (incl. the critical idempotency_key UNIQUE). Moved here by hand.
CREATE INDEX `idx_financial_transactions_member` ON `financial_transactions` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_debt` ON `financial_transactions` (`debt_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_type` ON `financial_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_member_type_created` ON `financial_transactions` (`member_id`,`type`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_financial_transactions_idempotency_key` ON `financial_transactions` (`idempotency_key`) WHERE "financial_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_inventory_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`tubes` integer NOT NULL,
	`price_per_tube` integer NOT NULL,
	`total_price` integer NOT NULL,
	`purchased_at` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`brand_id`) REFERENCES `shuttlecock_brands`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_purchases_tubes_positive" CHECK("__new_inventory_purchases"."tubes" >= 1),
	CONSTRAINT "inventory_purchases_money_non_negative" CHECK("__new_inventory_purchases"."price_per_tube" >= 0 AND "__new_inventory_purchases"."total_price" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_inventory_purchases`("id", "brand_id", "tubes", "price_per_tube", "total_price", "purchased_at", "notes", "created_at") SELECT "id", "brand_id", "tubes", "price_per_tube", "total_price", "purchased_at", "notes", "created_at" FROM `inventory_purchases`;--> statement-breakpoint
DROP TABLE `inventory_purchases`;--> statement-breakpoint
ALTER TABLE `__new_inventory_purchases` RENAME TO `inventory_purchases`;--> statement-breakpoint
CREATE TABLE `__new_session_shuttlecocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`quantity_used` integer NOT NULL,
	`price_per_tube` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `shuttlecock_brands`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_shuttlecocks_qty_positive" CHECK("__new_session_shuttlecocks"."quantity_used" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_session_shuttlecocks`("id", "session_id", "brand_id", "quantity_used", "price_per_tube") SELECT "id", "session_id", "brand_id", "quantity_used", "price_per_tube" FROM `session_shuttlecocks`;--> statement-breakpoint
DROP TABLE `session_shuttlecocks`;--> statement-breakpoint
ALTER TABLE `__new_session_shuttlecocks` RENAME TO `session_shuttlecocks`;