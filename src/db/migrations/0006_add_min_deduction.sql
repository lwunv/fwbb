CREATE TABLE `session_min_deduction_exemptions` (
	`session_id` integer NOT NULL,
	`member_id` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_min_deduction_exemptions_pk` ON `session_min_deduction_exemptions` (`session_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `use_min_deduction` integer DEFAULT false;