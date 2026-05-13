-- Phase 16/#27: track per-workspace daily digest push to avoid
-- double-sends. Stores the workspace-owner-local date of the last
-- successful (or successfully-skipped) push. Cron predicate excludes
-- workspaces whose marker already matches today in owner's TZ.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS last_daily_push_on DATE;
