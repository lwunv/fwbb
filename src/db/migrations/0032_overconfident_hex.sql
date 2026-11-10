CREATE TABLE `host_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`from_member_id` integer NOT NULL,
	`as_described` integer NOT NULL,
	`fee_as_promised` integer NOT NULL,
	`rater_weight` integer NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `exchange_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "host_feedback_rater_weight_range" CHECK("host_feedback"."rater_weight" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_feedback_event_from_unique` ON `host_feedback` (`event_id`,`from_member_id`);--> statement-breakpoint
CREATE INDEX `host_feedback_from_idx` ON `host_feedback` (`from_member_id`);--> statement-breakpoint
CREATE TABLE `host_flag_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_member_id` integer NOT NULL,
	`captives` integer NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`host_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "host_flag_reviews_captives_non_negative" CHECK("host_flag_reviews"."captives" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_flag_reviews_host_unique` ON `host_flag_reviews` (`host_member_id`);--> statement-breakpoint
CREATE TABLE `member_ip_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`ip_hash` text NOT NULL,
	`kind` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_ip_signals_member_hash_kind_unique` ON `member_ip_signals` (`member_id`,`ip_hash`,`kind`);--> statement-breakpoint
CREATE INDEX `member_ip_signals_hash_last_seen_idx` ON `member_ip_signals` (`ip_hash`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `member_ip_signals_last_seen_idx` ON `member_ip_signals` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `peer_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`from_member_id` integer NOT NULL,
	`to_member_id` integer NOT NULL,
	`play_again` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`skill_level` text,
	`rater_weight` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `exchange_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "peer_feedback_rater_weight_range" CHECK("peer_feedback"."rater_weight" BETWEEN 0 AND 5),
	CONSTRAINT "peer_feedback_not_self" CHECK("peer_feedback"."from_member_id" <> "peer_feedback"."to_member_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `peer_feedback_event_from_to_unique` ON `peer_feedback` (`event_id`,`from_member_id`,`to_member_id`);--> statement-breakpoint
CREATE INDEX `peer_feedback_to_updated_idx` ON `peer_feedback` (`to_member_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `peer_feedback_from_idx` ON `peer_feedback` (`from_member_id`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_member_id` integer NOT NULL,
	`referee_member_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`referrer_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referee_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "referrals_not_self" CHECK("referrals"."referrer_member_id" <> "referrals"."referee_member_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_referee_unique` ON `referrals` (`referee_member_id`);--> statement-breakpoint
CREATE INDEX `referrals_referrer_created_idx` ON `referrals` (`referrer_member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `venue_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`score_surface` integer NOT NULL,
	`score_lighting` integer NOT NULL,
	`score_ventilation` integer NOT NULL,
	`score_price` integer NOT NULL,
	`score_parking` integer NOT NULL,
	`score_owner` integer NOT NULL,
	`comment` text,
	`status` text DEFAULT 'visible' NOT NULL,
	`hold_reason` text,
	`report_count` integer DEFAULT 0 NOT NULL,
	`rater_weight` integer NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`edited_at` text,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "venue_reviews_score_surface_range" CHECK("venue_reviews"."score_surface" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_score_lighting_range" CHECK("venue_reviews"."score_lighting" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_score_ventilation_range" CHECK("venue_reviews"."score_ventilation" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_score_price_range" CHECK("venue_reviews"."score_price" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_score_parking_range" CHECK("venue_reviews"."score_parking" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_score_owner_range" CHECK("venue_reviews"."score_owner" BETWEEN 1 AND 5),
	CONSTRAINT "venue_reviews_report_count_non_negative" CHECK("venue_reviews"."report_count" >= 0),
	CONSTRAINT "venue_reviews_rater_weight_range" CHECK("venue_reviews"."rater_weight" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venue_reviews_venue_member_unique` ON `venue_reviews` (`venue_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `venue_reviews_venue_status_created_idx` ON `venue_reviews` (`venue_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `venue_reviews_status_updated_idx` ON `venue_reviews` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `venue_reviews_member_idx` ON `venue_reviews` (`member_id`);--> statement-breakpoint
ALTER TABLE `members` ADD `public_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `members_public_code_unique` ON `members` (`public_code`);--> statement-breakpoint
CREATE INDEX `exchange_events_end_at_idx` ON `exchange_events` (`end_at`);--> statement-breakpoint
CREATE INDEX `session_attendees_member_idx` ON `session_attendees` (`member_id`);