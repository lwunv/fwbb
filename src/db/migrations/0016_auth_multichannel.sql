ALTER TABLE `members` ADD `username` text;--> statement-breakpoint
ALTER TABLE `members` ADD `password_reset_expires_at` text;--> statement-breakpoint
ALTER TABLE `members` ADD `must_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_username_unique` ON `members` (`username`);