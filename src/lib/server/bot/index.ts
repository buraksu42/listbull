/**
 * Bot factory + handler registration (Phase 17 chat-only).
 *
 * Single default platform bot — white-label per-workspace bots
 * dropped. The env token is the only token; there's no `bots` table.
 */
import { Bot } from "grammy";

import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleItems } from "@/lib/server/bot/commands/items";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { handleChatMemberUpdate } from "@/lib/server/bot/handlers/chat-member-update";
import { handleItemActionCallback } from "@/lib/server/bot/handlers/item-action-callback";
import { handleMyChatMember } from "@/lib/server/bot/handlers/my-chat-member";
import { env } from "@/lib/env";

let cached: Bot | null = null;
let initPromise: Promise<Bot> | null = null;

export async function getBot(): Promise<Bot> {
  if (cached) return cached;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerHandlers(bot);
    await bot.init();
    cached = bot;
    return bot;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

function registerHandlers(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("reset", handleReset);
  bot.command("items", handleItems);

  // Inline-keyboard callbacks for /items view.
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data ?? "";
    if (data.startsWith("item:") || data.startsWith("items:")) {
      await handleItemActionCallback(ctx);
      return;
    }
    await next();
  });

  // Bot added to / removed from a chat.
  bot.on("my_chat_member", handleMyChatMember);

  // Another user's membership in a group changed.
  bot.on("chat_member", handleChatMemberUpdate);

  // Catch-all: free-form message → LLM router.
  bot.on("message", handleMessage);
}
