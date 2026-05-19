-- Add password-based auth: email/password login + signup, ngoài OAuth.
--
-- email cũng cần UNIQUE để tránh duplicate khi user signup bằng password
-- với email đã từng dùng cho OAuth. Existing rows có email null hoặc unique
-- (vì OAuth provider unique theo user) nên ALTER an toàn.

ALTER TABLE `members` ADD `password_hash` text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `members_email_unique` ON `members` (`email`);
