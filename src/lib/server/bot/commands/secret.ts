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
import { and, asc, eq, ilike, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items } from "@/lib/db/schema";
import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";
import { executeRevealSecret } from "@/lib/server/tools/reveal-secret";

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

  // Sub-command parsing: `/password`, `/password list`, `/password view <label>`.
  // Anything after the command name is treated as args. The original message
  // text still starts with `/password` (or `/sifre`) — strip it and trim.
  const raw = (message.text ?? "").trim();
  const args = raw.replace(/^\/(?:password|sifre)(?:@\w+)?\s*/i, "").trim();

  if (/^list$/i.test(args)) {
    await sendSecretList(ctx, chatId, user.id, locale);
    return;
  }

  const viewMatch = args.match(/^view\s+(.+)$/i);
  if (viewMatch) {
    const label = viewMatch[1]!.trim();
    await revealByLabel(ctx, chatId, user.id, label, locale);
    return;
  }

  // No args (or unknown args) → original save flow.
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

/**
 * `/password list` — show every stored secret's LABEL (never the value).
 * Pure read-only convenience; tapping a label is out of scope for now —
 * to view a value the user runs `/password view <label>` or asks the LLM.
 */
async function sendSecretList(
  ctx: Context,
  chatId: number,
  _userId: string,
  locale: "tr" | "en",
): Promise<void> {
  const rows = await db
    .select({ text: items.text })
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "secret"),
        isNotNull(items.secretEncrypted),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(asc(items.text));
  if (rows.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? "🔒 Henüz kayıtlı şifre yok. /password ile ekleyebilirsin."
        : "🔒 No saved passwords yet. Add one with /password.",
    );
    return;
  }
  const lines =
    locale === "tr"
      ? ["🔒 Kayıtlı şifreler:", ""]
      : ["🔒 Saved passwords:", ""];
  for (let i = 0; i < rows.length; i++) {
    lines.push(`${i + 1}. ${rows[i]!.text}`);
  }
  lines.push("");
  lines.push(
    locale === "tr"
      ? "Görmek için: `/password view <etiket>` veya \"<etiket> şifresi ne?\""
      : "To view: `/password view <label>` or \"what's the <label> password?\"",
  );
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

/**
 * `/password view <label>` — resolve the secret by case-insensitive label
 * match, then drive the reveal_secret executor which side-channels the
 * plaintext to the chat. If multiple labels match, ask the user to be
 * more specific instead of guessing.
 */
async function revealByLabel(
  ctx: Context,
  chatId: number,
  userId: string,
  label: string,
  locale: "tr" | "en",
): Promise<void> {
  const matches = await db
    .select({ id: items.id, text: items.text })
    .from(items)
    .where(
      and(
        eq(items.chatId, chatId),
        eq(items.kind, "secret"),
        isNotNull(items.secretEncrypted),
        isNull(items.archivedAt),
        ilike(items.text, `%${label.replace(/[%_]/g, "\\$&")}%`),
      ),
    )
    .limit(5);
  if (matches.length === 0) {
    await ctx.reply(
      locale === "tr"
        ? `🔒 "${label}" diye kayıt bulamadım. /password list ile bakabilirsin.`
        : `🔒 Couldn't find a secret named "${label}". Try /password list.`,
    );
    return;
  }
  if (matches.length > 1) {
    const names = matches.map((m) => `"${m.text}"`).join(", ");
    await ctx.reply(
      locale === "tr"
        ? `🔒 "${label}" birden fazla kayıtla eşleşti: ${names}. Daha net bir etiket ver.`
        : `🔒 "${label}" matched multiple entries: ${names}. Be more specific.`,
    );
    return;
  }
  const result = await executeRevealSecret(
    { item_id: matches[0]!.id },
    { userId, chatId },
  );
  if (!result.ok) {
    await ctx.reply(
      locale === "tr"
        ? `🔒 Açılamadı: ${result.error.message}`
        : `🔒 Couldn't reveal: ${result.error.message}`,
    );
    return;
  }
  // The plaintext is already in the chat (side-channel); just close the loop.
  await ctx.reply(
    locale === "tr"
      ? `🔒 "${result.data.label}" şifresini yukarıdaki mesaja yolladım — okuduktan sonra sil.`
      : `🔒 Sent "${result.data.label}" password above — delete after reading.`,
  );
}
