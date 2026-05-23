-- Phase 16/group: per-workspace persistent join link.
--
-- When a workspace is bound to a Telegram group, the bot posts a
-- "tap to join the workspace" link in that group. Anyone with the link
-- /start's the bot with `?start=joinws_<token>` and is added as an
-- editor (no per-user invite row, no username gate). The token lives
-- as long as the binding does; /unbindgroup clears it.
--
-- 32-byte URL-safe token (base64url, ~43 chars). Partial unique index
-- ensures NULL tokens (most workspaces) don't collide.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS join_link_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_join_link_token_uq
  ON workspaces (join_link_token)
  WHERE join_link_token IS NOT NULL;
