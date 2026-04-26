CREATE TABLE `financial_transactions` (
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
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_id`) REFERENCES `session_debts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`inventory_purchase_id`) REFERENCES `inventory_purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_member` ON `financial_transactions` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_debt` ON `financial_transactions` (`debt_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_type` ON `financial_transactions` (`type`);--> statement-breakpoint
CREATE TABLE `fund_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`is_active` integer DEFAULT true,
	`joined_at` text DEFAULT (current_timestamp),
	`left_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fund_members_member_id_unique` ON `fund_members` (`member_id`);--> statement-breakpoint
CREATE TABLE `payment_notifications` (
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
	FOREIGN KEY (`matched_debt_id`) REFERENCES `session_debts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_notifications_gmail_message_id_unique` ON `payment_notifications` (`gmail_message_id`);--> statement-breakpoint
ALTER TABLE `members` ADD `bank_account_no` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `admin_guest_play_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `admin_guest_dine_count` integer DEFAULT 0;