import { Bot } from "grammy";

import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleLists } from "@/lib/server/bot/commands/lists";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleShare } from "@/lib/server/bot/commands/share";
import { handleSnapshot } from "@/lib/server/bot/commands/snapshot";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { handleInlineQuery } from "@/lib/server/bot/handlers/inline-query";
import { env } from "@/lib/env";

let cached: Bot | null = null;
let initPromise: Promise<Bot> | null = null;

/**
 * Singleton bot instance — webhook handler reuses the same Bot object across
 * requests so handlers register only once. The first call awaits `bot.init()`
 * once (grammY requires this when using `handleUpdate` directly outside the
 * built-in webhook server); subsequent calls return the cached instance
 * synchronously via the resolved Promise.
 *
 * Order matters: slash commands are registered FIRST, then the catch-all
 * `message:text` handler. grammY's `bot.command()` filter takes priority
 * over `bot.on("message:text", ...)`, so commands always route through
 * their dedicated handlers; the LLM router only sees plain text messages.
 */
export async function getBot(): Promise<Bot> {
  if (cached) return cached;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

    // Slash commands take priority — registered before the LLM router.
    bot.command("start", handleStart);
    bot.command("help", handleHelp);
    bot.command("lists", handleLists);
    // Phase 3 commands.
    bot.command("share", handleShare);
    bot.command("reset", handleReset);
    // Phase 4 — D2 shareable list snapshot.
    bot.command("snapshot", handleSnapshot);

    // Phase 4 — D1 inline mode (`@listbull_bot <query>`).
    bot.on("inline_query", handleInlineQuery);

    // Phase 2 LLM router: any plain-text message that isn't a slash command.
    // Phase 4 extension: handleMessage detects forwarded messages and
    // routes them through the A3 forwarded-message extraction path.
    bot.on("message:text", handleMessage);

    // Required when using `bot.handleUpdate(update)` outside grammY's own
    // webhook server: fetches `botInfo` (id + username) once. Without this,
    // handleUpdate throws "Bot not initialized!".
    await bot.init();

    cached = bot;
    return bot;
  })();

  return initPromise;
}
