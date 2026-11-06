CREATE TABLE `exchange_comment_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`last_read_at` text,
	`last_read_group_at` text,
	FOREIGN KEY (`event_id`) REFERENCES `exchange_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_comment_reads_event_member_unique` ON `exchange_comment_reads` (`event_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `exchange_comment_reads_member_idx` ON `exchange_comment_reads` (`member_id`);--> statement-breakpoint
CREATE TABLE `exchange_comment_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `exchange_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_comment_votes_comment_member_unique` ON `exchange_comment_votes` (`comment_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `exchange_comment_votes_member_idx` ON `exchange_comment_votes` (`member_id`);--> statement-breakpoint
CREATE TABLE `exchange_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`channel` text NOT NULL,
	`parent_id` integer,
	`reply_to_member_id` integer,
	`author_member_id` integer NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`upvotes` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`idempotency_key` text,
	`edited_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `exchange_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `exchange_comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reply_to_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exchange_comments_upvotes_non_negative" CHECK("exchange_comments"."upvotes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `exchange_comments_event_channel_created_idx` ON `exchange_comments` (`event_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE INDEX `exchange_comments_event_created_idx` ON `exchange_comments` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `exchange_comments_parent_created_idx` ON `exchange_comments` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `exchange_comments_author_created_idx` ON `exchange_comments` (`author_member_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_comments_idempotency_key_unique` ON `exchange_comments` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `exchange_events` ADD `comments_locked` integer DEFAULT false NOT NULL;