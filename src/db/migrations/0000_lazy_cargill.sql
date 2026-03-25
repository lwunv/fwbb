CREATE TABLE `admins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `courts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`map_link` text,
	`price_per_session` integer NOT NULL,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `inventory_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`tubes` integer NOT NULL,
	`price_per_tube` integer NOT NULL,
	`total_price` integer NOT NULL,
	`purchased_at` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`brand_id`) REFERENCES `shuttlecock_brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`nickname` text,
	`avatar_key` text,
	`facebook_id` text NOT NULL,
	`avatar_url` text,
	`email` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_facebook_id_unique` ON `members` (`facebook_id`);--> statement-breakpoint
CREATE TABLE `session_attendees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`member_id` integer,
	`guest_name` text,
	`invited_by_id` integer,
	`is_guest` integer DEFAULT false,
	`attends_play` integer DEFAULT false,
	`attends_dine` integer DEFAULT false,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session_debts` (
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
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debts_session_member_idx` ON `session_debts` (`session_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `session_shuttlecocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`quantity_used` integer NOT NULL,
	`price_per_tube` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `shuttlecock_brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start_time` text DEFAULT '20:30',
	`end_time` text DEFAULT '22:30',
	`court_id` integer,
	`court_quantity` integer DEFAULT 1,
	`court_price` integer,
	`status` text DEFAULT 'voting',
	`dining_bill` integer,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`court_id`) REFERENCES `courts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_date` ON `sessions` (`date`);--> statement-breakpoint
CREATE TABLE `shuttlecock_brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`price_per_tube` integer NOT NULL,
	`is_active` integer DEFAULT true,
	`stock_adjust_qua` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`will_play` integer DEFAULT false,
	`will_dine` integer DEFAULT false,
	`guest_play_count` integer DEFAULT 0,
	`guest_dine_count` integer DEFAULT 0,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_session_member_idx` ON `votes` (`session_id`,`member_id`);