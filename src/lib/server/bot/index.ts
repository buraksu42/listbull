import { Bot } from "grammy";

import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleLists } from "@/lib/server/bot/commands/lists";
import { handleStart } from "@/lib/server/bot/commands/start";
import { env } from "@/lib/env";

let cached: Bot | null = null;

/**
 * Singleton bot instance — webhook handler reuses the same Bot object across
 * requests so handlers register only once.
 */
export function getBot(): Bot {
  if (cached) return cached;

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("lists", handleLists);

  // Phase 2 will wire LLM router on bot.on("message:text", ...)

  cached = bot;
  return bot;
}
