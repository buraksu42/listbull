import { Bot } from "grammy";

import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleLists } from "@/lib/server/bot/commands/lists";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleShare } from "@/lib/server/bot/commands/share";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { env } from "@/lib/env";

let cached: Bot | null = null;

/**
 * Singleton bot instance — webhook handler reuses the same Bot object across
 * requests so handlers register only once.
 *
 * Order matters: slash commands are registered FIRST, then the catch-all
 * `message:text` handler. grammY's `bot.command()` filter takes priority
 * over `bot.on("message:text", ...)`, so commands always route through
 * their dedicated handlers; the LLM router only sees plain text messages.
 */
export function getBot(): Bot {
  if (cached) return cached;

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Slash commands take priority — registered before the LLM router.
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("lists", handleLists);
  // Phase 3 commands.
  bot.command("share", handleShare);
  bot.command("reset", handleReset);

  // Phase 2 LLM router: any plain-text message that isn't a slash command.
  bot.on("message:text", handleMessage);

  cached = bot;
  return bot;
}
