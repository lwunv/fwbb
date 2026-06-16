ALTER TABLE `members` ADD `default_with_partner` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `headcount` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `votes` ADD `with_partner` integer DEFAULT false NOT NULL;