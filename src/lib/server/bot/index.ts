import { Bot } from "grammy";
import { eq } from "drizzle-orm";

import { handleBindGroup } from "@/lib/server/bot/commands/bind-group";
import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleLists } from "@/lib/server/bot/commands/lists";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleShare } from "@/lib/server/bot/commands/share";
import { handleSnapshot } from "@/lib/server/bot/commands/snapshot";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleUnbindGroup } from "@/lib/server/bot/commands/unbind-group";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { handleBindCallback } from "@/lib/server/bot/handlers/bind-callback";
import { handleChosenInlineResult } from "@/lib/server/bot/handlers/chosen-inline-result";
import { handleInlineQuery } from "@/lib/server/bot/handlers/inline-query";
import { handleMyChatMember } from "@/lib/server/bot/handlers/my-chat-member";
import { db } from "@/lib/db/client";
import { bots } from "@/lib/db/schema";
import { decrypt } from "@/lib/server/encryption";
import { env } from "@/lib/env";

/**
 * Bot instance pool with LRU eviction (Phase 5.5).
 *
 * Lookup keys:
 *   - "default" → platform bot (env.TELEGRAM_BOT_TOKEN). Pinned —
 *     never evicted; it's the highest-traffic instance.
 *   - <bot_id_uuid> → white-label bot from the `bots` table
 *
 * Each grammY instance holds ~5MB. With LRU bounded at 50 hot
 * instances, peak memory ~250MB regardless of how many white-label
 * bots exist. Cold bots get re-initialized lazily on the next
 * webhook hit (init = single getMe round-trip, ~50ms).
 *
 * Map iteration follows insertion order; we re-insert on access to
 * bump entries to MRU position. The oldest non-default key is the
 * eviction candidate when we hit POOL_CAP.
 *
 * Order matters in handler registration: slash commands FIRST, then
 * the catch-all `message:text`. grammY's `bot.command()` filter
 * takes priority over `bot.on("message:text", ...)`.
 */
const POOL_CAP = 50;

const cached = new Map<string, Bot>();
const initPromises = new Map<string, Promise<Bot>>();

function bumpLru(key: string): void {
  const v = cached.get(key);
  if (v === undefined) return;
  // Re-insert moves to MRU position.
  cached.delete(key);
  cached.set(key, v);
}

function evictOldest(): void {
  for (const key of cached.keys()) {
    if (key === "default") continue;
    cached.delete(key);
    return;
  }
}

/**
 * Get the default platform bot (env-token). Maintained as the legacy
 * call signature so existing call sites (cron dispatcher, share-list
 * invite DM) keep working unchanged.
 */
export async function getBot(): Promise<Bot> {
  return getBotByKey("default");
}

/**
 * Get a registered Telegram bot by its `bots.id` UUID. Phase 5
 * webhook router calls this with the bot ID extracted from the URL
 * path (`/api/telegram/webhook/[botId]`). Returns null when the
 * bot row is missing or the token can't be decrypted.
 */
export async function getBotById(botId: string): Promise<Bot | null> {
  try {
    return await getBotByKey(botId);
  } catch (err) {
    console.warn("[bot pool] init failed for", botId, err);
    return null;
  }
}

async function getBotByKey(key: string): Promise<Bot> {
  const existing = cached.get(key);
  if (existing) {
    bumpLru(key);
    return existing;
  }
  const inFlight = initPromises.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const token = await resolveToken(key);
    const bot = new Bot(token);
    registerHandlers(bot);
    await bot.init();
    if (cached.size >= POOL_CAP) evictOldest();
    cached.set(key, bot);
    return bot;
  })();

  initPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    initPromises.delete(key);
  }
}

async function resolveToken(key: string): Promise<string> {
  if (key === "default") return env.TELEGRAM_BOT_TOKEN;

  const [row] = await db
    .select({ tokenEncrypted: bots.telegramBotTokenEncrypted })
    .from(bots)
    .where(eq(bots.id, key))
    .limit(1);
  if (!row) {
    throw new Error(`bot pool: no bots row with id ${key}`);
  }
  return decrypt(row.tokenEncrypted);
}

function registerHandlers(bot: Bot): void {
  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  bot.command("lists", handleLists);
  bot.command("share", handleShare);
  bot.command("reset", handleReset);
  bot.command("snapshot", handleSnapshot);
  bot.command("bindgroup", handleBindGroup);
  bot.command("unbindgroup", handleUnbindGroup);
  bot.on("inline_query", handleInlineQuery);
  bot.on("chosen_inline_result", handleChosenInlineResult);
  // /bindgroup picker callbacks ride on callback_query updates. The
  // handler ignores anything that doesn't start with `bind:` so other
  // callback flows can be added later without colliding.
  bot.on("callback_query:data", handleBindCallback);
  // Bot was added to / removed from a chat. We auto-unbind on
  // remove and DM the inviter on add.
  bot.on("my_chat_member", handleMyChatMember);
  // Phase 14b: register on `message` (not `message:text`) so photos /
  // videos / documents / audio / voice / video_note also flow into
  // handleMessage. Slash commands stay routed via `bot.command()`
  // because grammY filters those before this catch-all.
  bot.on("message", handleMessage);
}

/**
 * Test / admin helper: drop a cached bot instance so the next
 * request rebuilds it from the DB. Called from the workspace
 * settings revoke endpoint after the operator removes a custom
 * bot's token.
 */
export function evictBotFromPool(key: string): void {
  cached.delete(key);
  initPromises.delete(key);
}
