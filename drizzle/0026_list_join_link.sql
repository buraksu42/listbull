-- Phase 16/#29: per-list username-less invite token + auto-membership
-- for public lists.
--
-- lists.join_link_token: base64url(32-byte) token, unique partial.
-- Generated lazily on first "Copy share link" tap; persists for the
-- lifetime of the list (or until explicitly rotated).

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS join_link_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS lists_join_link_token_uq
  ON lists (join_link_token)
  WHERE join_link_token IS NOT NULL;
