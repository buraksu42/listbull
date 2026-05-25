/**
 * Bot factory + handler registration (Phase 17 chat-only).
 *
 * Single default platform bot — white-label per-workspace bots
 * dropped. The env token is the only token; there's no `bots` table.
 */
import { Bot } from "grammy";

import { handleTag } from "@/lib/server/bot/commands/tag";
import { handleDone } from "@/lib/server/bot/commands/done";
import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleItems } from "@/lib/server/bot/commands/items";
import { handleMemory } from "@/lib/server/bot/commands/memory";
import { handleReminders } from "@/lib/server/bot/commands/reminders";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleSecret } from "@/lib/server/bot/commands/secret";
import {
  handleSettings,
  handleSettingsCallback,
} from "@/lib/server/bot/commands/settings";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleToday, handleWeek } from "@/lib/server/bot/commands/today";
import {
  handleOnboarding,
  handleOnboardingCallback,
} from "@/lib/server/bot/commands/onboarding";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { handleChatMemberUpdate } from "@/lib/server/bot/handlers/chat-member-update";
import { handleItemActionCallback } from "@/lib/server/bot/handlers/item-action-callback";
import { handleMyChatMember } from "@/lib/server/bot/handlers/my-chat-member";
import { groupReplyMiddleware } from "@/lib/server/bot/middleware/group-reply";
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
    // Sync the Telegram slash-command menu on every cold start so it
    // always matches the registered commands. Without this the menu
    // only changed when scripts/setup-bot.ts was re-run by hand —
    // stale entries (e.g. the removed /assigned) lingered. Idempotent;
    // failure is non-fatal.
    try {
      await bot.api.setMyCommands([
        { command: "items", description: "📋 Açık to-do'lar" },
        { command: "done", description: "✅ Tamamlananlar" },
        { command: "memory", description: "📁 Hafıza" },
        { command: "tag", description: "🏷️ Etikete göre işler (örn. /tag michael)" },
        { command: "today", description: "📅 Bugünkü işler" },
        { command: "thisweek", description: "🗓 Bu haftaki işler" },
        { command: "reminders", description: "🔔 Bekleyen hatırlatıcılar" },
        { command: "password", description: "🔒 Şifre sakla / görüntüle" },
        { command: "settings", description: "⚙️ Ayarlar" },
        { command: "onboarding", description: "🎯 Hızlı tur (yeni misin?)" },
        { command: "help", description: "❓ Yardım" },
        { command: "reset", description: "🧹 Konuşmayı sıfırla" },
      ]);
    } catch (e) {
      console.warn("[bot] setMyCommands failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
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
  // Auto-quote user message in groups (must run before any handler
  // that calls ctx.reply so the wrap is in place).
  bot.use(groupReplyMiddleware);

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("reset", handleReset);
  bot.command("items", handleItems);
  bot.command("done", handleDone);
  bot.command("memory", handleMemory);
  // English-only slash menu (user preference); /sifre kept as a
  // tolerant alias for anyone with the old command in muscle memory.
  bot.command(["password", "sifre"], handleSecret);
  // Slash commands are English-only by user preference — the bot
  // replies are still localized (TR/EN) based on users.locale.
  bot.command("today", handleToday);
  bot.command("thisweek", handleWeek);
  bot.command("tag", handleTag);
  bot.command("reminders", handleReminders);
  bot.command("settings", handleSettings);
  bot.command("onboarding", handleOnboarding);

  // Inline-keyboard callbacks.
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data ?? "";
    if (
      data.startsWith("item:") ||
      data.startsWith("items:") ||
      data.startsWith("memory:") ||
      data.startsWith("done:")
    ) {
      await handleItemActionCallback(ctx);
      return;
    }
    if (data.startsWith("settings:")) {
      await handleSettingsCallback(ctx);
      return;
    }
    if (data.startsWith("onboarding:")) {
      await handleOnboardingCallback(ctx);
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
