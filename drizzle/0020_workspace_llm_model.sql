-- LLM model becomes workspace-level (was per-user). Workspace owner
-- decides which model funds every member's bot turn — mirrors the
-- workspace-level API key collapse from 0019.
--
-- users.llm_model column stays for backfill / rollback safety; not
-- read by the bot any more (handle-message.ts uses workspaces.llm_model).

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "llm_model" text NOT NULL DEFAULT 'google/gemini-2.5-flash';
