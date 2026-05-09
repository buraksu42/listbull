-- Phase X (2026-05-09): task-level recurrence column.
-- Distinct from `item_reminders.recurrence_rule` (which only re-fires
-- reminder pings without resurrecting the task). When this column is
-- set, complete_item branches: deadline advances to next occurrence,
-- is_done resets to false, status flips back to 'open', and
-- completed_at clears. RFC 5545 RRULE body, no DTSTART or RRULE:
-- prefix — same convention as the reminders table.
ALTER TABLE "items" ADD COLUMN "task_recurrence_rule" text;
