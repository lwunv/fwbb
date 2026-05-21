-- Per-session vote deadline. NULL = no deadline (vote always open until
-- admin changes status). At session creation, app code default-fills
-- `${date}T${startTime}:00` − 4 hours.
--
-- Format: ISO 8601 without Z suffix (Vietnam local time interpretation,
-- matching `date` and `start_time` conventions). `strftime` here produces
-- exactly that format.

ALTER TABLE `sessions` ADD `vote_deadline` text;
--> statement-breakpoint

-- Backfill existing sessions that are still accepting votes. Completed /
-- cancelled sessions stay NULL — voting is already blocked by status.
-- Sessions whose start_time is already in the past will get a past
-- deadline → they auto-show as "vote closed" until admin extends, which is
-- the intended behaviour (don't silently reopen zombie sessions).
UPDATE `sessions`
   SET `vote_deadline` = strftime('%Y-%m-%dT%H:%M:%S', date || ' ' || start_time, '-4 hours')
 WHERE status IN ('voting', 'confirmed') AND vote_deadline IS NULL;
