-- 0032 — bot_action_contexts.metadata for two-step flows.
--
-- The /şifre flow needs to carry a label across two force-replies:
--   1. bot asks "etiket ne?" → user replies "Gmail"
--   2. bot stores Gmail in metadata, asks "şifreyi yapıştır"
--   3. user replies with password → encrypt, insert secret with text=metadata
--
-- Generic enough to also serve any future "multi-step prompt" flow.

ALTER TABLE bot_action_contexts
  ADD COLUMN IF NOT EXISTS metadata text;
