CREATE TABLE `rate_limit_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	`updated_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_buckets_reset_at` ON `rate_limit_buckets` (`reset_at`);--> statement-breakpoint
ALTER TABLE `courts` ADD `price_per_session_retail` integer;--> statement-breakpoint
ALTER TABLE `financial_transactions` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_financial_transactions_idempotency_key` ON `financial_transactions` (`idempotency_key`) WHERE "financial_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `pass_revenue` integer;