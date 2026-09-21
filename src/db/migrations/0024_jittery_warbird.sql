ALTER TABLE `members` ADD `gender` text;--> statement-breakpoint
ALTER TABLE `session_attendees` ADD `gender` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `admin_guest_play_female_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sessions` ADD `admin_guest_dine_female_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `votes` ADD `guest_play_female_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `votes` ADD `guest_dine_female_count` integer DEFAULT 0;