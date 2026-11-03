CREATE TABLE `venues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`area_label` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`map_link` text,
	`court_count` integer,
	`open_hours` text,
	`amenities` text DEFAULT '[]' NOT NULL,
	`phone` text,
	`ref_price_per_hour` integer,
	`photo_link` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_by_member_id` integer,
	`approved_at` text,
	`created_at` text DEFAULT (current_timestamp),
	`updated_at` text DEFAULT (current_timestamp),
	FOREIGN KEY (`submitted_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "venues_ref_price_non_negative" CHECK("venues"."ref_price_per_hour" IS NULL OR "venues"."ref_price_per_hour" >= 0),
	CONSTRAINT "venues_court_count_positive" CHECK("venues"."court_count" IS NULL OR "venues"."court_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX `venues_status_lat_lng_idx` ON `venues` (`status`,`lat`,`lng`);--> statement-breakpoint
ALTER TABLE `courts` ADD `venue_id` integer REFERENCES venues(id);