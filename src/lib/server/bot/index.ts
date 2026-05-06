import { Bot } from "grammy";
import { eq } from "drizzle-orm";

import { handleHelp } from "@/lib/server/bot/commands/help";
import { handleLists } from "@/lib/server/bot/commands/lists";
import { handleReset } from "@/lib/server/bot/commands/reset";
import { handleShare } from "@/lib/server/bot/commands/share";
import { handleSnapshot } from "@/lib/server/bot/commands/snapshot";
import { handleStart } from "@/lib/server/bot/commands/start";
import { handleMessage } from "@/lib/server/bot/handle-message";
import { handleInlineQuery } from "@/lib/server/bot/handlers/inline-query";
import { db } from "@/lib/db/client";
import { bots } from "@/lib/db/schema";
import { decrypt } from "@/lib/server/encryption";
import { env } from "@/lib/env";

/**
 * Bot instance pool. Phase 5 multi-bot support — each registered
 * Telegram bot (default platform bot + workspace-tier white-label
 * bots) gets its own grammY Bot instance with the same handler set.
 *
 * Lookup keys:
 *   - "default" → the platform bot (env.TELEGRAM_BOT_TOKEN)
 *   - <bot_id_uuid> → a workspace's white-label bot from the `bots` table
 *
 * Init is async + cached: first request per key awaits bot.init();
 * subsequent requests return the cached instance.
 *
 * Memory profile: each grammY instance holds ~5MB. Phase 5 cap (15
 * white-label bots × 100 paying customers ≈ 1500 instances) would
 * be ~7.5GB if we keep them all hot. For Phase 5 launch we cache
 * indefinitely; Phase 6+ adds LRU eviction (out of scope here).
 *
 * Order matters: slash commands are registered FIRST, then the catch-
 * all `message:text` handler. grammY's `bot.command()` filter takes
 * priority over `bot.on("message:text", ...)`.
 */
const cached = new Map<string, Bot>();
const initPromises = new Map<string, Promise<Bot>>();

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
  if (existing) return existing;
  const inFlight = initPromises.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const token = await resolveToken(key);
    const bot = new Bot(token);
    registerHandlers(bot);
    await bot.init();
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
  bot.on("inline_query", handleInlineQuery);
  bot.on("message:text", handleMessage);
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
