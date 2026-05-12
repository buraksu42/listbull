-- Drop per-user OpenRouter BYOK column.
--
-- Key resolution collapsed to a single path: workspace owner sets
-- the OpenRouter API key on the workspace, every member of that
-- workspace uses it. The users.openrouter_api_key_encrypted column
-- and its decrypt/redact UI path go away. workspaces.openrouter_api_key_encrypted
-- stays — that's the new single source of truth.

ALTER TABLE "users" DROP COLUMN IF EXISTS "openrouter_api_key_encrypted";
