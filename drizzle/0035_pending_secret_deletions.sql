-- 0035 — pending_secret_deletions (security audit M5).
--
-- Durable backup for reveal_secret's 15s auto-delete: a row is
-- written when the bot delivers a plaintext credential; the cron
-- dispatcher sweeps rows whose fire_at has passed, attempts the
-- Telegram deleteMessage, and drops the row. The in-process
-- setTimeout in reveal-secret.ts still handles the fast path —
-- this table is the restart-safe floor.

CREATE TABLE IF NOT EXISTS "pending_secret_deletions" (
  "chat_id" bigint NOT NULL,
  "message_id" bigint NOT NULL,
  "fire_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "pending_secret_deletions_chat_id_chats_chat_id_fk"
    FOREIGN KEY ("chat_id")
    REFERENCES "chats"("chat_id")
    ON DELETE CASCADE
);

-- Composite PK enforced via unique index (matches drizzle schema).
CREATE UNIQUE INDEX IF NOT EXISTS "pending_secret_deletions_pk"
  ON "pending_secret_deletions" ("chat_id", "message_id");

-- Pickup-order index for the cron sweep query.
CREATE INDEX IF NOT EXISTS "pending_secret_deletions_due_idx"
  ON "pending_secret_deletions" ("fire_at");
