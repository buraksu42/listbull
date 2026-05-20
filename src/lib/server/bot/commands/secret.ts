/**
 * /password (alias /sifre) — encrypted credential storage.
 *
 * SAVE flow always runs in the user's DM (plaintext never lands in a
 * group thread). Three steps: label → username → password — handled
 * across this command + handle-message intercepts.
 *
 *   • /password in DM   → secret scoped to the DM (targetChatId null).
 *   • /password in group → bot DMs the flow; the secret is scoped to
 *     the GROUP (targetChatId = group chat id), so any group member
 *     can later reveal it in the group.
 *
 * READ surfaces (`/password list`, `/password view <label>`, and the
 * natural-language "X şifresi ne?" intercept) work in groups too —
 * a group-scoped secret reveals in its group, where the bot deletes
 * its own 15s-TTL side-channel message.
 *
 * The LLM is NEVER invoked for the save steps — plaintext stays out
 * of the messages table and the OpenRouter request payload.
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
  const isGroup = message.chat.type !== "private";

  // Sub-command parsing: `/password`, `/password list`, `/password view <label>`.
  const raw = (message.text ?? "").trim();
  const args = raw.replace(/^\/(?:password|sifre)(?:@\w+)?\s*/i, "").trim();

  // READ surfaces work in groups too — scoped to the current chat.
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

  // SAVE flow. Always runs in the user's DM. In a group, the secret
  // is scoped to that group via targetChatId; in DM, targetChatId
  // stays null (DM-scoped).
  const targetChatId = isGroup ? chatId : null;
  const groupTitle =
    isGroup && "title" in message.chat
      ? (message.chat as { title?: string }).title ?? null
      : null;
  const prompt = isGroup
    ? locale === "tr"
      ? `🔒 "${groupTitle ?? "bu grup"}" için şifre kaydı.\n\nEtiket ne olsun? (örn. Ofis Wi-Fi, Netflix)`
      : `🔒 Password entry for "${groupTitle ?? "this group"}".\n\nWhat's the label? (e.g. Office Wi-Fi, Netflix)`
    : locale === "tr"
      ? "🔒 Yeni şifre kaydı.\n\nEtiket ne olsun? (örn. Gmail, Netflix, Ev Wi-Fi)"
      : "🔒 New password entry.\n\nWhat's the label? (e.g. Gmail, Netflix, Home Wi-Fi)";

  // The save flow's force-reply prompt always goes to the user's DM
  // (their Telegram id == their DM chat id).
  try {
    const sent = await ctx.api.sendMessage(from.id, prompt, {
      reply_markup: { force_reply: true, selective: true },
    });
    await insertBotActionContext({
      chatId: from.id,
      messageId: sent.message_id,
      action: "secret_label",
      itemId: null,
      targetChatId,
      metadata: null,
    });
  } catch {
    // Bot can't DM the user (they never /start'ed the DM).
    await ctx.reply(
      locale === "tr"
        ? "🔒 Şifre kaydı DM'de yapılır ama sana yazamıyorum. Önce bana DM'den /start yaz, sonra tekrar dene."
        : "🔒 Password setup happens in DM but I can't message you. Send me /start in DM first, then retry.",
    );
    return;
  }

  if (isGroup) {
    await ctx.reply(
      locale === "tr"
        ? "📩 Şifreyi DM'den kuralım — sana özelden yazdım, oradan devam et."
        : "📩 Let's set the password in DM — I've messaged you privately, continue there.",
    );
  }
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
 *
 * Exported so handle-message's natural-language intercept ("X şifresi
 * ne?") can route directly without the LLM in the loop — haiku has
 * repeatedly hallucinated "bulamadım" without calling search_items.
 */
export { revealByLabel as tryRevealSecretByLabel };

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
