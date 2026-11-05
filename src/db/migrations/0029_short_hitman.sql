CREATE TABLE `abuse_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_member_id` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`reporter_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `abuse_reports_reporter_target_unique` ON `abuse_reports` (`reporter_member_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `abuse_reports_status_created_idx` ON `abuse_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `abuse_reports_target_idx` ON `abuse_reports` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `exchange_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_code` text NOT NULL,
	`idempotency_key` text,
	`host_member_id` integer NOT NULL,
	`venue_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`skill_min` text,
	`skill_max` text,
	`slots_total` integer NOT NULL,
	`female_reserved_slots` integer DEFAULT 0 NOT NULL,
	`reserve_release_at` text,
	`host_heads` integer DEFAULT 1 NOT NULL,
	`shuttle_type` text,
	`fee_mode` text NOT NULL,
	`fee_amount_male` integer,
	`fee_amount_female` integer,
	`fee_female_percent` integer,
	`estimated_total_cost` integer,
	`min_heads` integer,
	`deposit_amount` integer DEFAULT 0 NOT NULL,
	`register_deadline` text NOT NULL,
	`cancel_deadline` text NOT NULL,
	`auto_approve` integer DEFAULT false NOT NULL,
	`allow_plus_ones` integer DEFAULT false NOT NULL,
	`payout_bank_bin` text,
	`payout_account_no` text,
	`payout_account_name` text,
	`host_contact` text,
	`zalo_group_link` text,
	`status` text DEFAULT 'open' NOT NULL,
	`lock_count` integer DEFAULT 0 NOT NULL,
	`locked_at` text,
	`done_at` text,
	`cancelled_at` text,
	`hidden_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`host_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exchange_events_fee_male_non_negative" CHECK("exchange_events"."fee_amount_male" IS NULL OR "exchange_events"."fee_amount_male" >= 0),
	CONSTRAINT "exchange_events_fee_female_non_negative" CHECK("exchange_events"."fee_amount_female" IS NULL OR "exchange_events"."fee_amount_female" >= 0),
	CONSTRAINT "exchange_events_estimated_cost_non_negative" CHECK("exchange_events"."estimated_total_cost" IS NULL OR "exchange_events"."estimated_total_cost" >= 0),
	CONSTRAINT "exchange_events_min_heads_non_negative" CHECK("exchange_events"."min_heads" IS NULL OR "exchange_events"."min_heads" >= 0),
	CONSTRAINT "exchange_events_deposit_non_negative" CHECK("exchange_events"."deposit_amount" >= 0),
	CONSTRAINT "exchange_events_slots_total_positive" CHECK("exchange_events"."slots_total" >= 1),
	CONSTRAINT "exchange_events_female_reserved_range" CHECK("exchange_events"."female_reserved_slots" BETWEEN 0 AND "exchange_events"."slots_total"),
	CONSTRAINT "exchange_events_host_heads_non_negative" CHECK("exchange_events"."host_heads" >= 0),
	CONSTRAINT "exchange_events_fee_female_percent_range" CHECK("exchange_events"."fee_female_percent" IS NULL OR "exchange_events"."fee_female_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_events_public_code_unique` ON `exchange_events` (`public_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_events_idempotency_key_unique` ON `exchange_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `exchange_events_status_start_idx` ON `exchange_events` (`status`,`start_at`);--> statement-breakpoint
CREATE INDEX `exchange_events_venue_start_idx` ON `exchange_events` (`venue_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `exchange_events_host_start_idx` ON `exchange_events` (`host_member_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `exchange_registrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`male_count` integer DEFAULT 0 NOT NULL,
	`female_count` integer DEFAULT 0 NOT NULL,
	`note` text,
	`waitlist_pos` integer,
	`fee_amount` integer,
	`fee_waived` integer DEFAULT false NOT NULL,
	`deposit_paid` integer DEFAULT false NOT NULL,
	`deposit_paid_at` text,
	`paid` integer DEFAULT false NOT NULL,
	`paid_amount` integer,
	`paid_at` text,
	`checked_in` integer DEFAULT false NOT NULL,
	`checked_in_at` text,
	`decided_at` text,
	`cancelled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `exchange_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exchange_regs_male_non_negative" CHECK("exchange_registrations"."male_count" >= 0),
	CONSTRAINT "exchange_regs_female_non_negative" CHECK("exchange_registrations"."female_count" >= 0),
	CONSTRAINT "exchange_regs_heads_positive" CHECK("exchange_registrations"."male_count" + "exchange_registrations"."female_count" >= 1),
	CONSTRAINT "exchange_regs_fee_non_negative" CHECK("exchange_registrations"."fee_amount" IS NULL OR "exchange_registrations"."fee_amount" >= 0),
	CONSTRAINT "exchange_regs_paid_non_negative" CHECK("exchange_registrations"."paid_amount" IS NULL OR "exchange_registrations"."paid_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_registrations_event_member_unique` ON `exchange_registrations` (`event_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `exchange_registrations_event_status_idx` ON `exchange_registrations` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `exchange_registrations_member_status_idx` ON `exchange_registrations` (`member_id`,`status`);--> statement-breakpoint
CREATE INDEX `exchange_registrations_member_checked_in_idx` ON `exchange_registrations` (`member_id`,`checked_in`);--> statement-breakpoint
CREATE TABLE `host_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_member_id` integer NOT NULL,
	`blocked_member_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`host_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_blocks_host_blocked_unique` ON `host_blocks` (`host_member_id`,`blocked_member_id`);