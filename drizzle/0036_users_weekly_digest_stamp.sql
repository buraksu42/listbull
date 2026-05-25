-- Sunday 21:00 user-local weekly digest idempotency stamp.
-- Mirrors `daily_digest_sent_on` (Phase 15) — same `date` shape,
-- stored in user-local TZ at write time so cron-tick drift across
-- UTC midnight does not cause a re-send.

ALTER TABLE "users" ADD COLUMN "weekly_digest_sent_on" date;

-- Partial index matching `users_digest_pickup_idx` (notif gate +
-- stamp column) so the weekly cron's pickup query is index-covered.
CREATE INDEX "users_weekly_digest_pickup_idx"
  ON "users" ("notifications_enabled", "weekly_digest_sent_on")
  WHERE "notifications_enabled" = true;
