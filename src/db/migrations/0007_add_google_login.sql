-- Add Google OAuth support. Members can login via Facebook OR Google.
-- `facebook_id` becomes nullable (Google-only users have NULL there).
-- `google_id` is unique nullable text holding Google `sub` claim.
--
-- SQLite không support ALTER COLUMN DROP NOT NULL trực tiếp → dùng pattern
-- create-new / copy / drop / rename. Cẩn thận giữ nguyên indexes + FK.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `__new_members` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `nickname` text,
  `avatar_key` text,
  `facebook_id` text,
  `google_id` text,
  `avatar_url` text,
  `email` text,
  `bank_account_no` text,
  `is_active` integer DEFAULT true,
  `created_at` text DEFAULT (current_timestamp)
);
--> statement-breakpoint

INSERT INTO `__new_members`
  (id, name, nickname, avatar_key, facebook_id, google_id, avatar_url, email,
   bank_account_no, is_active, created_at)
SELECT
  id, name, nickname, avatar_key, facebook_id, NULL, avatar_url, email,
  bank_account_no, is_active, created_at
FROM `members`;
--> statement-breakpoint

DROP TABLE `members`;
--> statement-breakpoint

ALTER TABLE `__new_members` RENAME TO `members`;
--> statement-breakpoint

CREATE UNIQUE INDEX `members_facebook_id_unique` ON `members` (`facebook_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_google_id_unique` ON `members` (`google_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_bank_account_no_unique` ON `members` (`bank_account_no`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
