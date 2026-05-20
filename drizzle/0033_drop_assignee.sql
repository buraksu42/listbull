-- 0033 — drop the assignee feature.
--
-- Per-user task assignment (assign_item tool, /assigned command) is
-- removed in favour of plain tags: "assign to Burak" becomes the tag
-- #burak, and `/tag burak` lists everything tagged that way. The
-- items.assignee_id column + its index are no longer referenced by
-- any code path.

DROP INDEX IF EXISTS "items_assignee_idx";

ALTER TABLE "items"
  DROP COLUMN IF EXISTS "assignee_id";
