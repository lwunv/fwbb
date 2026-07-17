ALTER TABLE `admins` ADD `email` text;--> statement-breakpoint
ALTER TABLE `admins` ADD `phone_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `admins_email_unique` ON `admins` (`email`);