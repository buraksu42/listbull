/**
 * Architect-owned shared types for the multi-bot layer (Phase 4.5
 * schema-only; Phase 5 ships the white-label registration flow).
 *
 * Phase 4.5 seeds exactly ONE row in `bots` (the default platform
 * bot) and binds every existing workspace + user to it. The
 * white-label admin UI + per-bot webhook router land in Phase 5.
 *
 * Backend imports these for the bot router + reminder dispatch
 * (Phase 5). Frontend imports for the workspace settings "Custom
 * bot" section (Phase 5).
 */
import type { botUsers, bots, workspaceBots } from "@/lib/db/schema";

// ─── Bot ────────────────────────────────────────────────────────────

/**
 * A registered Telegram bot. Either:
 *  - the default platform bot (`is_default = true`, `created_by = null`),
 *    seeded once during the Phase 4.5 migration, OR
 *  - a workspace's white-label bot registered by a Workspace-tier
 *    admin (Phase 5+).
 *
 * `telegramBotTokenEncrypted` is AES-256-GCM ciphertext using the
 * same helper as BYOK OpenRouter keys (`@/lib/auth/crypto`); never
 * decrypted into log output, never echoed in tool results.
 */
export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;

// ─── WorkspaceBot ───────────────────────────────────────────────────

/**
 * Junction row binding a workspace to a bot. Many-to-many: a
 * workspace MAY be reachable via the default bot AND a white-label
 * bot during transition. `is_primary = true` denotes the workspace's
 * own white-label bot; default platform bot rows always have
 * `is_primary = false`.
 *
 * Phase 4.5 seeds one row per (workspace, default_bot) with
 * `is_primary = false`. Phase 5 admin UI may add a second row with
 * `is_primary = true` when a custom bot is registered.
 */
export type WorkspaceBot = typeof workspaceBots.$inferSelect;
export type NewWorkspaceBot = typeof workspaceBots.$inferInsert;

// ─── BotUser ────────────────────────────────────────────────────────

/**
 * Records that a Telegram user has `/start`'ed a particular bot.
 * Required precondition for sending DMs from that bot — Telegram
 * returns 403 forbidden if the user has not started the bot.
 *
 * Used by `share_list` invite flow + Phase 5 reminder dispatch:
 * before sending a DM via bot X to user Y, verify `bot_users` row
 * exists for `(bot_id = X, user_id = Y)`. If absent, fall back to
 * the default platform bot (which every user has started).
 *
 * Composite PK `(bot_id, user_id)` — no surrogate id.
 */
export type BotUser = typeof botUsers.$inferSelect;
export type NewBotUser = typeof botUsers.$inferInsert;

// ─── Public-safe view-models ─────────────────────────────────────────

/**
 * Bot info safe to surface in the Mini App / LLM tool output. Excludes
 * the encrypted token + webhook secret. Used in workspace settings
 * "Custom bot" section UI (Phase 5) and the `list_workspace_bots`
 * read tool (Phase 5+).
 */
export type BotPublic = {
  id: string;
  telegramBotId: number;
  telegramBotUsername: string;
  isDefault: boolean;
  /** ISO 8601 string. */
  createdAt: string;
};

/**
 * Bot binding view-model — one row per (workspace, bot) pair, joined
 * with the bot's public info. Powers the workspace settings page's
 * "Custom bot" section.
 */
export type WorkspaceBotBinding = {
  workspaceId: string;
  bot: BotPublic;
  isPrimary: boolean;
  /** ISO 8601 string. */
  boundAt: string;
};
