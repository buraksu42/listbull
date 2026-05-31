/**
 * One-shot Telegram bot setup helper (Phase 17 chat-only).
 *
 * Configures everything the public Bot API exposes for the listbull
 * bot, then prints the BotFather-only steps the operator still has to
 * run by hand (Telegram doesn't expose `/setdomain`, `/setjoingroups`,
 * or `/setprivacy` over the public API).
 *
 * Bot is the only surface — no Mini App, no web menu button. All
 * interaction is in-chat (inline keyboards via `/items`, free-form
 * messages routed through the LLM).
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
 *   ASSERT_PRIVACY_OFF=1         # exit non-zero if Telegram privacy mode
 *                                # is still ON (getMe.can_read_all_group_
 *                                # messages === false). Use as a drift
 *                                # tripwire in CI / post-deploy checks —
 *                                # privacy ON silently drops group voice
 *                                # notes and plain @-text mentions (the
 *                                # exact regression seen 2026-05-31).
 *                                # Leave unset on first setup, since the
 *                                # /setprivacy BotFather step runs after.
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
  const me = await tg<{
    username: string;
    first_name: string;
    can_read_all_group_messages?: boolean;
  }>("getMe", {});
  console.log(`  ok: @${me.username} (${me.first_name})`);
  const botUsername = process.env.BOT_USERNAME ?? me.username;

  // Privacy-mode evidence layer. `can_read_all_group_messages === true`
  // means BotFather privacy is OFF — the required state. Privacy ON
  // silently drops group voice notes and hand-typed @-text mentions
  // (no `mention` entity → Telegram never delivers them). Build success
  // ≠ delivery; this is the only check that catches the drift.
  const privacyOff = me.can_read_all_group_messages === true;
  console.log(
    `  privacy: ${privacyOff ? "OFF ✅ (can_read_all_group_messages=true)" : "ON ⚠️  (can_read_all_group_messages=false)"}`,
  );
  if (!privacyOff) {
    console.warn(
      "  ⚠️  Privacy is ON — group voice + plain @-text mentions will be\n" +
        "      silently dropped. Disable it via BotFather (see step 3 below),\n" +
        "      then REMOVE + RE-ADD the bot to existing groups (Telegram\n" +
        "      caches privacy per-membership).",
    );
  }

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
    // English-only by user preference — replies are still localized
    // via users.locale. Descriptions kept short so autocomplete fits
    // the Telegram dropdown.
    commands: [
      { command: "start", description: "Get started" },
      { command: "help", description: "How to use" },
      { command: "items", description: "Open to-dos 📋" },
      { command: "done", description: "Completed items ✅" },
      { command: "memory", description: "Memory keepsakes 📁" },
      { command: "password", description: "Save / view passwords 🔒 (DM-only)" },
      { command: "today", description: "Today's items 📅" },
      { command: "thisweek", description: "This week's items 🗓" },
      { command: "tag", description: "Items by tag 🏷️ (e.g. /tag burak)" },
      { command: "reminders", description: "Pending reminders 🔔" },
      { command: "reset", description: "Clear conversation" },
    ],
  });
  console.log(`  ok`);

  console.log("→ setChatMenuButton (commands)");
  // Bot is the only surface — no web_app menu button. Telegram's
  // default commands menu is the entry point.
  await tg("setChatMenuButton", {
    menu_button: { type: "commands" },
  });
  console.log(`  ok: menu set to default commands`);

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
  console.log(`                       (group voice notes can't @-mention`);
  console.log(`                        the bot; privacy-off lets them reach`);
  console.log(`                        the webhook. The bot's own code still`);
  console.log(`                        only acts on @mentions, replies, and`);
  console.log(`                        voice — no token waste on chatter.)`);
  console.log(`  4. After disabling privacy, REMOVE + RE-ADD the bot to any`);
  console.log(`     existing groups — Telegram caches the privacy setting`);
  console.log(`     per-membership, so the toggle only applies to groups`);
  console.log(`     joined AFTER the change. Then re-run with`);
  console.log(`     ASSERT_PRIVACY_OFF=1 to confirm.`);
  console.log("");

  // Drift tripwire. Opt-in so first-time setup (run before the BotFather
  // /setprivacy step) doesn't fail; CI / post-deploy checks set the flag
  // to turn privacy-ON into a hard failure.
  if (!privacyOff && process.env.ASSERT_PRIVACY_OFF) {
    console.error(
      "✗ ASSERT_PRIVACY_OFF: privacy mode is ON (getMe.can_read_all_group_messages=false).",
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ ${msg}`);
  process.exit(1);
});
