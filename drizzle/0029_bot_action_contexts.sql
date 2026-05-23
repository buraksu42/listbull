-- 0029 — bot_action_contexts: persist force-reply action metadata
-- so the user-facing prompt no longer needs an inline `[ctx:...]`
-- marker.

CREATE TABLE IF NOT EXISTS "bot_action_contexts" (
  "chat_id" bigint NOT NULL,
  "message_id" bigint NOT NULL,
  "action" text NOT NULL,
  "item_id" uuid,
  "target_chat_id" bigint,
  "created_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "bot_action_contexts_pk"
  ON "bot_action_contexts" ("chat_id", "message_id");

CREATE INDEX IF NOT EXISTS "bot_action_contexts_created_idx"
  ON "bot_action_contexts" ("created_at");
