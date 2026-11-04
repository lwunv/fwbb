CREATE TABLE `notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notification_id` integer NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_id` integer NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`error_code` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_notification_channel_unique` ON `notification_deliveries` (`notification_id`,`channel`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_next_idx` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_recipient_sent_idx` ON `notification_deliveries` (`recipient_type`,`recipient_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_id` integer NOT NULL,
	`muted_groups` text DEFAULT '[]' NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`unsub_token` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_prefs_recipient_unique` ON `notification_prefs` (`recipient_type`,`recipient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_prefs_unsub_token_unique` ON `notification_prefs` (`unsub_token`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text,
	`entity_id` integer,
	`payload` text NOT NULL,
	`mandatory` integer DEFAULT false NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	`dedup_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedup_key_unique` ON `notifications` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_unread_idx` ON `notifications` (`recipient_type`,`recipient_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_created_idx` ON `notifications` (`recipient_type`,`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_entity_idx` ON `notifications` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_key` text NOT NULL,
	`kind` text NOT NULL,
	`session_id` integer,
	`run_at` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`message_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_jobs_job_key_unique` ON `scheduled_jobs` (`job_key`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_status_run_at_idx` ON `scheduled_jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_session_status_idx` ON `scheduled_jobs` (`session_id`,`status`);--> statement-breakpoint
ALTER TABLE `admins` ADD `role` text DEFAULT 'superadmin' NOT NULL;--> statement-breakpoint
ALTER TABLE `members` ADD `notify_email_verified_for` text;