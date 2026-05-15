-- 0030 — item_reminders schema drift fix.
--
-- Drizzle schema.ts declares `sent_at` and has no `updated_at`. The
-- DB still had `last_sent_at` (legacy name from Phase 14d) and an
-- unused `updated_at` column. Every add_reminder INSERT exploded
-- with "column \"sent_at\" does not exist".
--
-- Idempotent via conditional checks in pg_catalog.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'item_reminders' AND column_name = 'last_sent_at'
  ) THEN
    ALTER TABLE item_reminders RENAME COLUMN last_sent_at TO sent_at;
  END IF;
END$$;

ALTER TABLE item_reminders
  DROP COLUMN IF EXISTS updated_at;
