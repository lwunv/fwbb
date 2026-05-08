DROP INDEX `idx_sessions_date`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_date` ON `sessions` (`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_bank_account_no_unique` ON `members` (`bank_account_no`);--> statement-breakpoint
ALTER TABLE `payment_notifications` ALTER COLUMN "matched_transaction_id" TO "matched_transaction_id" integer REFERENCES financial_transactions(id) ON DELETE no action ON UPDATE no action;