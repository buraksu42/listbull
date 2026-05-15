/**
 * One-shot Telegram bot setup helper (Phase 17 chat-only).
 *
 * Configures everything the public Bot API exposes for the listbull
 * bot, then prints the BotFather-only steps the operator still has to
 * run by hand (Telegram doesn't expose `/setdomain`, `/setjoingroups`,
 * or `/setprivacy` over the public API).
 *
 * Mini App was frozen in Phase 17 — this script no longer registers a
 * chat menu button. All interaction is in-chat (inline keyboards via
 * `/items`, free-form messages routed through the LLM).
 *
 * Run:
 *   TELEGRAM_BOT_TOKEN=<token> \
 *   TELEGRAM_WEBHOOK_SECRET=<secret> \
 *   APP_BASE_URL=https://prod.listbull.org \
 *     npx tsx scripts/setup-bot.ts
 *
 * Optional:
 *   BOT_USERNAME=listbull_bot    # only used to render the BotFather
 *                                # instructions at the end. If missing,
 *                                # the script reads it from getMe.
 */
import process from "node:process";

type Json = Record<string, unknown>;

const TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
const SECRET = mustEnv("TELEGRAM_WEBHOOK_SECRET");
const APP_BASE_URL = mustEnv("APP_BASE_URL").replace(/\/+$/, "");

const webhookUrl = `${APP_BASE_URL}/api/telegram/webhook`;

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    console.error(`✗ Missing env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function tg<T extends Json>(method: string, body: Json): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: T };
  if (!json.ok) {
    throw new Error(`${method} failed: ${json.description ?? "unknown"}`);
  }
  return (json.result ?? ({} as T));
}

async function main(): Promise<void> {
  console.log("→ getMe");
  const me = await tg<{ username: string; first_name: string }>("getMe", {});
  console.log(`  ok: @${me.username} (${me.first_name})`);
  const botUsername = process.env.BOT_USERNAME ?? me.username;

  console.log("→ setWebhook");
  await tg("setWebhook", {
    url: webhookUrl,
    secret_token: SECRET,
    drop_pending_updates: true,
    // chat_member: pick up new-member joins so auto-onboarding works.
    allowed_updates: [
      "message",
      "callback_query",
      "my_chat_member",
      "chat_member",
    ],
  });
  console.log(`  ok: ${webhookUrl}`);

  console.log("→ setMyCommands");
  await tg("setMyCommands", {
    // Names must be ASCII a-z0-9_; descriptions can be UTF-8. Both TR
    // and EN entries are registered so the autocomplete works in both
    // locales — they all share a handler in src/lib/server/bot/index.ts.
    commands: [
      { command: "start", description: "Get started / başla" },
      { command: "help", description: "How to use / yardım" },
      { command: "items", description: "Show all items / tüm işler 📋" },
      { command: "today", description: "Today's items 📅" },
      { command: "bugun", description: "Bugünün işleri 📅" },
      { command: "thisweek", description: "This week's items 🗓" },
      { command: "buhafta", description: "Bu haftaki işler 🗓" },
      { command: "assigned", description: "Assigned items 👤" },
      { command: "atanan", description: "Atanan işler 👤" },
      { command: "reminders", description: "Pending reminders 🔔" },
      { command: "hatirlaticilar", description: "Hatırlatıcılar 🔔" },
      { command: "reset", description: "Clear conversation / sıfırla" },
    ],
  });
  console.log(`  ok`);

  console.log("→ deleteChatMenuButton (Mini App frozen)");
  // Pivot: Mini App is dormant, so no web_app menu button — fall back
  // to Telegram's default commands menu.
  await tg("setChatMenuButton", {
    menu_button: { type: "commands" },
  });
  console.log(`  ok: menu reset to default commands`);

  console.log("→ getWebhookInfo");
  const info = await tg<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_message?: string;
    allowed_updates?: string[];
  }>("getWebhookInfo", {});
  console.log(`  url: ${info.url}`);
  console.log(`  pending_update_count: ${info.pending_update_count}`);
  console.log(`  last_error: ${info.last_error_message ?? "(none)"}`);
  console.log(`  allowed_updates: ${(info.allowed_updates ?? []).join(", ")}`);

  console.log("");
  console.log("=========================================================");
  console.log("DONE — automatable bot setup applied.");
  console.log("=========================================================");
  console.log("");
  console.log("Still required (BotFather has no public API for these —");
  console.log("you must run them in chat with @BotFather yourself):");
  console.log("");
  console.log(`  1. Open https://t.me/BotFather`);
  console.log(`  2. /setjoingroups   @${botUsername} → Enable`);
  console.log(`                       (lets users add the bot to groups)`);
  console.log(`  3. /setprivacy      @${botUsername} → Disable`);
  console.log(`                       (chat-only model needs to see all`);
  console.log(`                        group messages, not just @mentions)`);
  console.log("");
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ ${msg}`);
  process.exit(1);
});
