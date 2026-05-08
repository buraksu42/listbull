-- Phase 15: 09:00 daily digest idempotency marker.
--
-- `date` (not timestamptz) — the digest is a once-per-user-day event;
-- we only need to know whether today's date in the user's timezone
-- has already received a digest. The hourly cron tick filters via
-- `(now() AT TIME ZONE u.timezone)::date`.
ALTER TABLE "users" ADD COLUMN "daily_digest_sent_on" date;
--> statement-breakpoint
CREATE INDEX "users_digest_pickup_idx"
	ON "users" USING btree ("notifications_enabled", "daily_digest_sent_on")
	WHERE "users"."notifications_enabled" = true;
