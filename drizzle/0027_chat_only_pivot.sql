-- Phase 17: chat-only pivot. Workspaces + lists + sharing primitives
-- are removed; items + activity_log + item_attachments now reference
-- a Telegram chat_id directly. White-label bots are dropped (env-token
-- default bot serves all chats).
--
-- DESTRUCTIVE — test data wipe assumed (user confirmed no critical
-- rows). Not idempotent in the strict sense, but every CREATE / ALTER
-- guards with IF EXISTS / IF NOT EXISTS so a re-run on a half-applied
-- DB completes cleanly.

BEGIN;

-- ─── Drop dependent FKs FIRST so DROP COLUMN below doesn't trip ───
-- items.list_id, item_attachments.workspace_id, activity_log.list_id,
-- users.active_workspace_id all reference soon-to-be-dropped tables.
-- Drop the columns BEFORE dropping the referenced tables; the CASCADE
-- DROPs below would also work but we make the ordering explicit.

ALTER TABLE items DROP COLUMN IF EXISTS list_id;
ALTER TABLE activity_log DROP COLUMN IF EXISTS list_id;
ALTER TABLE item_attachments DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE users DROP COLUMN IF EXISTS active_workspace_id;

-- ─── Drop workspace + list ecosystem (CASCADE for safety) ─────────

DROP TABLE IF EXISTS workspace_invites CASCADE;
DROP TABLE IF EXISTS workspace_bots CASCADE;
DROP TABLE IF EXISTS workspace_members CASCADE;
DROP TABLE IF EXISTS list_invites CASCADE;
DROP TABLE IF EXISTS list_runs_items CASCADE;
DROP TABLE IF EXISTS list_runs CASCADE;
DROP TABLE IF EXISTS list_members CASCADE;
DROP TABLE IF EXISTS lists CASCADE;
DROP TABLE IF EXISTS bot_users CASCADE;
DROP TABLE IF EXISTS bots CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
-- snapshots table doesn't exist in this codebase; comment kept for posterity.

-- ─── Wipe items / activity / messages / attachments so we don't ───
-- end up with orphan rows after the column swap below. Users wiped
-- too so /start fresh-flows during the chat-only rollout.

DELETE FROM item_reminders;
DELETE FROM item_attachments;
DELETE FROM items;
DELETE FROM activity_log;
DELETE FROM messages;
DELETE FROM users;

-- ─── Create chats + chat_members ──────────────────────────────────

CREATE TABLE IF NOT EXISTS chats (
  chat_id BIGINT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  openrouter_api_key_encrypted TEXT,
  llm_model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  last_daily_push_on DATE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chats_owner_idx ON chats(owner_user_id);

CREATE TABLE IF NOT EXISTS chat_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_chat_user_uq
  ON chat_members(chat_id, user_id);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members(user_id);

-- ─── Add chat_id columns to items / activity_log / item_attachments ─

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS chat_id BIGINT NOT NULL
  REFERENCES chats(chat_id) ON DELETE CASCADE;

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS chat_id BIGINT
  REFERENCES chats(chat_id) ON DELETE CASCADE;

ALTER TABLE item_attachments
  ADD COLUMN IF NOT EXISTS chat_id BIGINT NOT NULL
  REFERENCES chats(chat_id) ON DELETE CASCADE;

-- ─── Rebuild indexes that referenced list_id ──────────────────────

DROP INDEX IF EXISTS items_list_id_idx;
DROP INDEX IF EXISTS items_status_idx;
DROP INDEX IF EXISTS activity_list_recent_idx;
DROP INDEX IF EXISTS item_attachments_workspace_idx;

CREATE INDEX IF NOT EXISTS items_chat_idx
  ON items(chat_id, archived_at, is_done, position);
CREATE INDEX IF NOT EXISTS items_status_idx
  ON items(chat_id, status);
CREATE INDEX IF NOT EXISTS activity_chat_recent_idx
  ON activity_log(chat_id, created_at DESC);

COMMIT;
