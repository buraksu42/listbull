-- Phase 16/group: bind a Telegram group/supergroup to a workspace.
--
-- When the bot is added to a group and the owner runs /bindgroup, we
-- record the group's Telegram chat_id here. The unique partial index
-- prevents one chat from binding to two workspaces; NULL values are
-- allowed (most workspaces aren't bound to a group).
--
-- chat_id is BIGINT because Telegram supergroup IDs are large negatives
-- like -100xxxxxxxxxx (13+ digits, fits in i64). Drizzle uses
-- mode: "number" for compactness; this is safe because JS numbers
-- handle values up to 2^53-1 and Telegram chat_ids stay well below.

ALTER TABLE workspaces
  ADD COLUMN linked_telegram_chat_id BIGINT;

CREATE UNIQUE INDEX workspaces_linked_chat_id_uq
  ON workspaces (linked_telegram_chat_id)
  WHERE linked_telegram_chat_id IS NOT NULL;
