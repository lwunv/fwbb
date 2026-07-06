CREATE TABLE `member_oauth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_uid` text NOT NULL,
	`email` text,
	`created_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_provider_uid_unique` ON `member_oauth_identities` (`provider`,`provider_uid`);--> statement-breakpoint
CREATE INDEX `oauth_member_id_idx` ON `member_oauth_identities` (`member_id`);