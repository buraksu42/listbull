/**
 * Bot factory + handler registration (Phase 17 chat-only).
 *
 * Single default platform bot — white-label per-workspace bots
 * dropped. The env token is the only token; there's no `bots` table.
 */
import { Bot } from "grammy";

import { handleAssigned } from "@/lib/server/bot/commands/assigned";
import { handleDone } from "@/lib/server/bot/commands/done";
import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleItems } from "@/lib/server/bot/commands/items";
import { handleMemory } from "@/lib/server/bot/commands/memory";
import { handleReminders } from "@/lib/server/bot/commands/reminders";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleSecret } from "@/lib/server/bot/commands/secret";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleToday, handleWeek } from "@/lib/server/bot/commands/today";
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
    // Standard procedure: every time someone adds the bot to a group,
    // Telegram surfaces an admin-rights dialog with these boxes
    // pre-checked. This buys us:
    //   • `chat_member` event delivery — requires admin, lets us
    //     auto-sync members on join/leave (so "ata Aysel'e" works
    //     without waiting for Aysel to message first).
    //   • can_delete_messages — needed to redact a pasted password
    //     in group chats.
    //   • can_invite_users — opens future share-link / invite flows.
    // Idempotent on the Telegram side; safe to call on every cold
    // start. Failure is logged but non-fatal.
    try {
      await bot.api.setMyDefaultAdministratorRights({
        rights: {
          is_anonymous: false,
          can_manage_chat: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_manage_video_chats: false,
          can_restrict_members: false,
          can_promote_members: false,
          can_change_info: false,
          can_post_messages: false,
          can_edit_messages: false,
          can_pin_messages: false,
          can_manage_topics: false,
          can_post_stories: false,
          can_edit_stories: false,
          can_delete_stories: false,
        },
        for_channels: false,
      });
    } catch (e) {
      console.warn("[bot] setMyDefaultAdministratorRights failed", {
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
  bot.command("assigned", handleAssigned);
  bot.command("reminders", handleReminders);

  // Inline-keyboard callbacks for /items + /memory views.
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
    await next();
  });

  // Bot added to / removed from a chat.
  bot.on("my_chat_member", handleMyChatMember);

  // Another user's membership in a group changed.
  bot.on("chat_member", handleChatMemberUpdate);

  // Catch-all: free-form message → LLM router.
  bot.on("message", handleMessage);
}
