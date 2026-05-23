-- Phase 16/#28: list-level public/private visibility.
--
-- visibility='private' (default) keeps existing behavior — list is
-- only visible/editable to users with a row in list_members.
--
-- visibility='public' opens the list to every workspace member;
-- read/write capability is then governed by the workspace role
-- (owner/admin/editor write, viewer/guest read-only).
--
-- workspaces.default_list_visibility sets the default for new lists
-- created in that workspace. Existing workspaces default to 'private'
-- (no behavior change). Workspace owner can change it at any time.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS default_list_visibility TEXT NOT NULL DEFAULT 'private';

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

-- Index helps listListsForUser's "show all public lists in this
-- workspace I'm a member of" filter.
CREATE INDEX IF NOT EXISTS lists_workspace_visibility_idx
  ON lists (workspace_id, visibility)
  WHERE archived_at IS NULL;
