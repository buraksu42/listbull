-- 0028 — Switch default LLM model to anthropic/claude-haiku-4.5.
--
-- Reason: gemini-2.5-flash regressed on tool routing during live testing
-- (relative-time math errors, UUID hallucination, malformed add_reminder
-- args). User explicitly chose haiku-4.5 as the reliability/cost balance.
--
-- This migration:
--   1. Updates the column DEFAULT on users.llm_model + chats.llm_model.
--   2. UPDATEs every existing row that's still on the gemini default so
--      the swap takes effect for the test chat that already exists.
--      Rows that the user already moved to a different model (e.g.
--      claude-sonnet-4) are left alone.

ALTER TABLE users
  ALTER COLUMN llm_model SET DEFAULT 'anthropic/claude-haiku-4.5';
ALTER TABLE chats
  ALTER COLUMN llm_model SET DEFAULT 'anthropic/claude-haiku-4.5';

UPDATE users
SET llm_model = 'anthropic/claude-haiku-4.5'
WHERE llm_model = 'google/gemini-2.5-flash';

UPDATE chats
SET llm_model = 'anthropic/claude-haiku-4.5'
WHERE llm_model = 'google/gemini-2.5-flash';
