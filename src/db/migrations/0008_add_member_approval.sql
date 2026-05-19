-- Member approval flow + phone number.
--
-- New OAuth signups giờ vào trạng thái 'pending' chờ admin duyệt.
-- Members có sẵn (admin tạo / migrated từ Facebook trước feature này) đều
-- coi như đã 'approved' — column default 'approved' + backfill cho ai có
-- isActive=true. Rejected users không vào nhóm dù có cookie hợp lệ.

ALTER TABLE `members` ADD `phone_number` text;
--> statement-breakpoint

ALTER TABLE `members` ADD `approval_status` text DEFAULT 'approved';
--> statement-breakpoint

ALTER TABLE `members` ADD `approved_at` text;
--> statement-breakpoint

ALTER TABLE `members` ADD `approved_by` integer;
--> statement-breakpoint

-- Backfill: tất cả member hiện có → approved (an toàn vì họ đều là member
-- đã hoạt động). approved_at = createdAt để có timestamp; approved_by NULL.
UPDATE `members` SET `approval_status` = 'approved', `approved_at` = `created_at`
  WHERE `approval_status` IS NULL OR `approval_status` = '';
