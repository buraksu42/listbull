-- Phase 14c: per-user date / time display preferences.
--
-- App-layer enum (no DB CHECK):
--   date_format: 'DD.MM.YYYY' (default) | 'MM/DD/YYYY' | 'YYYY-MM-DD'
--   time_format: '24h' (default) | '12h'
--
-- TR-friendly defaults match the primary persona; backfill flips EN
-- locale rows to a US-friendly default to avoid surprising existing
-- English users with European date order.
ALTER TABLE "users"
	ADD COLUMN "date_format" text DEFAULT 'DD.MM.YYYY' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
	ADD COLUMN "time_format" text DEFAULT '24h' NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "date_format" = 'MM/DD/YYYY',
    "time_format" = '12h'
WHERE "locale" = 'en';
