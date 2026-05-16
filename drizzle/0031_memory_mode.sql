-- 0031 — Memory mode foundation.
--
-- Add discriminator + parent FK + secret payload to items so we can
-- represent three concepts on the same table:
--   * kind='todo'    → standard to-do (default, unchanged)
--   * kind='memory'  → never-auto-delete keepsake (tickets, docs)
--   * kind='secret'  → encrypted credential, always nested under a
--                       memory parent (no orphan secrets), DM-only.
--
-- Phase A is foundation-only — no behavior change for existing rows
-- because the default is 'todo'. The surface (/memory, /şifre) lands
-- in later phases.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'todo';

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS parent_item_id uuid
    REFERENCES items(id) ON DELETE CASCADE;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS secret_encrypted text;

-- kind discriminator must stay inside the known set.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_kind_chk;
ALTER TABLE items
  ADD CONSTRAINT items_kind_chk
    CHECK (kind IN ('todo', 'memory', 'secret'));

-- secret_encrypted is the AES-256-GCM envelope; only valid on secrets.
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_secret_kind_chk;
ALTER TABLE items
  ADD CONSTRAINT items_secret_kind_chk
    CHECK (secret_encrypted IS NULL OR kind = 'secret');

-- Secrets must always be nested under a memory parent (no orphan
-- credentials floating in the chat surface).
ALTER TABLE items
  DROP CONSTRAINT IF EXISTS items_secret_parent_chk;
ALTER TABLE items
  ADD CONSTRAINT items_secret_parent_chk
    CHECK (kind <> 'secret' OR parent_item_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS items_kind_idx
  ON items (chat_id, kind, archived_at, position);

CREATE INDEX IF NOT EXISTS items_parent_idx
  ON items (parent_item_id) WHERE parent_item_id IS NOT NULL;
