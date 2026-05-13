/**
 * One-shot Telegram bot setup helper.
 *
 * Configures everything the public Bot API exposes for a freshly
 * created bot, then prints the BotFather-only steps the operator
 * still has to do by hand (Telegram doesn't expose `/newapp`,
 * `/setmainminiapp`, `/setdomain`, `/setinline`, `/setinlinefeedback`,
 * or `/setjoingroups` over the public API).
 *
 * Run:
 *   TELEGRAM_BOT_TOKEN=<token> \
 *   TELEGRAM_WEBHOOK_SECRET=<secret> \
 *   APP_BASE_URL=https://prod.listbull.org \
 *     npx tsx scripts/setup-bot.ts
 *
 * Optional:
 *   BOT_USERNAME=listbull_bot    # only used to render the
 *                                # BotFather instructions at the end.
 *                                # If missing, the script reads it
 *                                # from getMe.
 *   MENU_BUTTON_LABEL=listbull   # default "Open App"
 */
import process from "node:process";

type Json = Record<string, unknown>;

const TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
const SECRET = mustEnv("TELEGRAM_WEBHOOK_SECRET");
const APP_BASE_URL = mustEnv("APP_BASE_URL").replace(/\/+$/, "");
const MENU_LABEL = process.env.MENU_BUTTON_LABEL ?? "Open App";

const webhookUrl = `${APP_BASE_URL}/api/telegram/webhook`;
const miniAppUrl = `${APP_BASE_URL}/app`;

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
    allowed_updates: [
      "message",
      "inline_query",
      "chosen_inline_result",
      "callback_query",
      "my_chat_member",
    ],
  });
  console.log(`  ok: ${webhookUrl}`);

  console.log("→ setMyCommands");
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "Get started" },
      { command: "help", description: "How to use the bot" },
      { command: "lists", description: "Show your lists" },
      { command: "share", description: "Share a list with someone" },
      { command: "snapshot", description: "Send a list snapshot to chat" },
      { command: "bindgroup", description: "Bind a workspace to a group" },
      { command: "unbindgroup", description: "Unbind a workspace from this group" },
      { command: "reset", description: "Clear conversation context" },
    ],
  });
  console.log(`  ok`);

  console.log("→ setChatMenuButton");
  await tg("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: MENU_LABEL,
      web_app: { url: miniAppUrl },
    },
  });
  console.log(`  ok: web_app "${MENU_LABEL}" → ${miniAppUrl}`);

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
  console.log(`  2. /setdomain          @${botUsername} → ${hostnameOf(APP_BASE_URL)}`);
  console.log(`  3. /setjoingroups      @${botUsername} → Enable`);
  console.log(`                          (lets users add the bot to`);
  console.log(`                           groups for /bindgroup support)`);
  console.log(`  4. /setprivacy         @${botUsername} → Enable`);
  console.log(`                          (bot only sees @mentions +`);
  console.log(`                           commands + replies-to-bot —`);
  console.log(`                           never the whole group convo)`);
  console.log(`  5. /setinline          @${botUsername} → Enable`);
  console.log(`                          placeholder: Search items…`);
  console.log(`  6. /setinlinefeedback  @${botUsername} → Enabled`);
  console.log(`                          (required for Quick Create)`);
  console.log("");
  console.log("  Chat-list \"Open\" affordance (direct-link Mini App):");
  console.log(`  7. /newapp             @${botUsername}`);
  console.log(`                          Title:       listbull`);
  console.log(`                          Description: AI list assistant`);
  console.log(`                          Photo:       640x360 PNG (or skip)`);
  console.log(`                          URL:         ${miniAppUrl}`);
  console.log(`                          Short name:  app`);
  console.log(`                          → link: t.me/${botUsername}/app`);
  console.log(`  8. /setmainminiapp     @${botUsername} → app → Enabled`);
  console.log(`                          (then RESTART your Telegram client`);
  console.log(`                           — chat-list affordance is cached)`);
  console.log("");
  console.log("Verify after step 7: bot's row in Telegram chat list shows");
  console.log("a launch icon; tapping opens the Mini App without entering");
  console.log("the chat first.");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ ${msg}`);
  process.exit(1);
});
