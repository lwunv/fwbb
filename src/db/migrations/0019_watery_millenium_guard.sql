CREATE TABLE `dup_ignored_pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id_low` integer NOT NULL,
	`member_id_high` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`member_id_low`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id_high`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dup_ignored_pairs_low_high_idx` ON `dup_ignored_pairs` (`member_id_low`,`member_id_high`);