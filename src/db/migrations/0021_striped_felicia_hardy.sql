ALTER TABLE `admins` ADD `google_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `admins_google_id_unique` ON `admins` (`google_id`);