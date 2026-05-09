-- Phase 14a: optional long-form description on items.
--
-- Additive — no backfill needed. Existing items get description=NULL
-- and the Mini App + bot UI render nothing for those rows.
ALTER TABLE "items" ADD COLUMN "description" text;
