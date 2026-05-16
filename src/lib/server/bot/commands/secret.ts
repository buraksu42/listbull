/**
 * /sifre (or /secret) — DM-only encrypted credential storage.
 *
 * Flow (handled across this command + handle-message intercepts):
 *   1. User: /sifre (in DM)
 *   2. Bot: "Şifrenin etiketi ne? (örn. Gmail, Wi-Fi)"
 *           + force-reply, action context = 'secret_label'
 *   3. User replies: "Gmail"
 *   4. handle-message picks up the secret_label reply, sends:
 *      "Şimdi şifreyi yapıştır. Mesajını otomatik sileceğim."
 *           + force-reply, action context = 'secret_value', metadata = "Gmail"
 *   5. User replies with the password value.
 *   6. handle-message picks up the secret_value reply, encrypts with
 *      ENV_KEY, ensures a parent memory item "📁 Şifreler", inserts
 *      a kind='secret' child carrying secret_encrypted, deletes the
 *      user's pasted message, confirms.
 *
 * The LLM is NEVER invoked for steps 4–6 — plaintext stays out of
 * the messages table and the OpenRouter request payload.
 *
 * Group chats refuse with a "DM'ime gel" nudge.
 */
import type { Context } from "grammy";

import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

export async function handleSecret(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const chatId = message.chat.id;

  if (message.chat.type !== "private") {
    await ctx.reply(
      locale === "tr"
        ? "🔒 Şifre saklama güvenlik nedeniyle sadece DM'de çalışır. DM'ime gel ve /password yaz."
        : "🔒 Password storage is DM-only. Message me privately and run /password.",
    );
    return;
  }

  const prompt =
    locale === "tr"
      ? "🔒 Yeni şifre kaydı.\n\nEtiket ne olsun? (örn. Gmail, Netflix, Ev Wi-Fi)"
      : "🔒 New password entry.\n\nWhat's the label? (e.g. Gmail, Netflix, Home Wi-Fi)";
  const sent = await ctx.api.sendMessage(chatId, prompt, {
    reply_markup: { force_reply: true, selective: true },
  });
  await insertBotActionContext({
    chatId,
    messageId: sent.message_id,
    action: "secret_label",
    itemId: null,
    targetChatId: null,
    metadata: null,
  });
}
