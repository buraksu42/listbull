/**
 * /settings — view + change preferences via inline buttons.
 *
 * One-tap toggles: language (tr⇄en), notifications, date/time format.
 * Timezone + LLM model are read-only (need free-text / a preset list).
 * OpenRouter key: shows whether the chat has its own key; a button
 * starts the key-paste flow (DM force-reply; in a group the owner is
 * DMed). Key removal drops the chat back to the free tier.
 *
 * Callback prefixes (routed in index.ts → handleSettingsCallback):
 *   settings:lang | settings:notif | settings:datefmt | settings:timefmt
 *   settings:key       → start key-set flow
 *   settings:keyremove → clear the chat's key (owner-only in groups)
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chats, users } from "@/lib/db/schema";
import { getChatById } from "@/lib/db/queries/chats";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { insertBotActionContext } from "@/lib/db/queries/bot-action-contexts";
import { pickLocale } from "@/lib/server/bot/i18n";

const DATE_FORMATS = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

type SettingsUser = {
  locale: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  llmModel: string;
  notificationsEnabled: boolean;
};

function buildSettingsView(
  u: SettingsUser,
  keySet: boolean,
  locale: "tr" | "en",
): { text: string; keyboard: InlineKeyboard } {
  const tr = locale === "tr";
  const langName = u.locale === "tr" ? "Türkçe" : "English";
  const notifOn = u.notificationsEnabled;
  const keyLine = tr
    ? keySet
      ? "🔑 OpenRouter key: kendi key'in ✓"
      : "🔑 OpenRouter key: yok — ücretsiz modeldesin"
    : keySet
      ? "🔑 OpenRouter key: your own key ✓"
      : "🔑 OpenRouter key: none — on the free model";

  const lines = tr
    ? [
        "⚙️ Ayarlar",
        "",
        `🌐 Dil: ${langName}`,
        `🔔 Bildirimler: ${notifOn ? "Açık" : "Kapalı"}`,
        `📅 Tarih biçimi: ${u.dateFormat}`,
        `⏰ Saat biçimi: ${u.timeFormat}`,
        `🕐 Saat dilimi: ${u.timezone}`,
        `🤖 Model: ${u.llmModel}`,
        keyLine,
        "",
        "Saat dilimi / model için yaz: \"saat dilimi İstanbul\", \"modeli değiştir\".",
      ]
    : [
        "⚙️ Settings",
        "",
        `🌐 Language: ${langName}`,
        `🔔 Notifications: ${notifOn ? "On" : "Off"}`,
        `📅 Date format: ${u.dateFormat}`,
        `⏰ Time format: ${u.timeFormat}`,
        `🕐 Timezone: ${u.timezone}`,
        `🤖 Model: ${u.llmModel}`,
        keyLine,
        "",
        "For timezone / model, just say: \"timezone Istanbul\", \"change the model\".",
      ];

  const keyboard = new InlineKeyboard()
    .text(
      `🌐 ${tr ? "Dil" : "Language"} → ${u.locale === "tr" ? "English" : "Türkçe"}`,
      "settings:lang",
    )
    .row()
    .text(
      notifOn
        ? tr
          ? "🔔 Bildirimleri kapat"
          : "🔔 Turn notifications off"
        : tr
          ? "🔔 Bildirimleri aç"
          : "🔔 Turn notifications on",
      "settings:notif",
    )
    .row()
    .text(
      tr ? "📅 Tarih biçimini değiştir" : "📅 Cycle date format",
      "settings:datefmt",
    )
    .row()
    .text(
      `⏰ ${tr ? "Saat" : "Time"} → ${u.timeFormat === "24h" ? "12h" : "24h"}`,
      "settings:timefmt",
    )
    .row()
    .text(
      keySet
        ? tr
          ? "🔑 OpenRouter key'i değiştir"
          : "🔑 Change OpenRouter key"
        : tr
          ? "🔑 OpenRouter key ekle"
          : "🔑 Add OpenRouter key",
      "settings:key",
    );
  if (keySet) {
    keyboard
      .row()
      .text(
        tr ? "🗑️ Key'i kaldır (ücretsiz moda dön)" : "🗑️ Remove key (back to free)",
        "settings:keyremove",
      );
  }

  return { text: lines.join("\n"), keyboard };
}

export async function handleSettings(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const chat = await getChatById(message.chat.id);
  const keySet = (chat?.openrouterApiKeyEncrypted ?? null) !== null;
  const { text, keyboard } = buildSettingsView(user, keySet, locale);
  await ctx.reply(text, { reply_markup: keyboard });
}

/** Routes `settings:*` callback taps. Registered from index.ts. */
export async function handleSettingsCallback(ctx: Context): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  const data = cb.data;
  if (!data.startsWith("settings:")) return;

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery();
    return;
  }
  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const isGroup =
    ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  // ── Key-set flow: start a force-reply to paste the key ────────────
  if (data === "settings:key") {
    if (isGroup) {
      // Owner-only; the key is pasted in the owner's DM (never in the
      // group thread). Mirrors the my_chat_member onboarding.
      const chat = await getChatById(chatId);
      if (!chat || chat.ownerUserId !== user.id) {
        await ctx.answerCallbackQuery(
          locale === "tr"
            ? "Sadece grup sahibi key ekleyebilir."
            : "Only the group owner can set the key.",
        );
        return;
      }
      await ctx.answerCallbackQuery();
      try {
        const sent = await ctx.api.sendMessage(
          cb.from.id,
          locale === "tr"
            ? "🔑 Grup için OpenRouter key'ini BU MESAJI YANITLAYARAK gönder (sk-or-v1-… ile başlar). Güvenli kaydederim, mesajını silerim."
            : "🔑 REPLY to this message with the group's OpenRouter key (starts with sk-or-v1-…). I save it securely and delete your message.",
          { reply_markup: { force_reply: true, selective: true } },
        );
        await insertBotActionContext({
          chatId: cb.from.id,
          messageId: sent.message_id,
          action: "set_key",
          itemId: null,
          targetChatId: chatId,
          metadata: null,
        });
      } catch {
        await ctx.api
          .sendMessage(
            chatId,
            locale === "tr"
              ? "🔑 Sana DM atamadım — önce bana DM'de /start yaz, sonra /settings'ten tekrar dene."
              : "🔑 Couldn't DM you — send me /start in DM first, then retry from /settings.",
          )
          .catch(() => undefined);
      }
      return;
    }
    // DM: force-reply in this chat.
    await ctx.answerCallbackQuery();
    const sent = await ctx.api.sendMessage(
      chatId,
      locale === "tr"
        ? "🔑 OpenRouter key'ini BU MESAJI YANITLAYARAK yapıştır (sk-or-v1-… ile başlar). Güvenli kaydederim, mesajını silerim."
        : "🔑 REPLY to this message with your OpenRouter key (starts with sk-or-v1-…). I save it securely and delete your message.",
      { reply_markup: { force_reply: true, selective: true } },
    );
    await insertBotActionContext({
      chatId,
      messageId: sent.message_id,
      action: "set_key",
      itemId: null,
      targetChatId: null,
      metadata: null,
    });
    return;
  }

  // ── Key removal → chat falls back to the free tier ───────────────
  if (data === "settings:keyremove") {
    if (isGroup) {
      const chat = await getChatById(chatId);
      if (!chat || chat.ownerUserId !== user.id) {
        await ctx.answerCallbackQuery(
          locale === "tr"
            ? "Sadece grup sahibi key'i kaldırabilir."
            : "Only the group owner can remove the key.",
        );
        return;
      }
    }
    await db
      .update(chats)
      .set({ openrouterApiKeyEncrypted: null, updatedAt: new Date() })
      .where(eq(chats.chatId, chatId));
    await ctx.answerCallbackQuery(
      locale === "tr" ? "🗑️ Key kaldırıldı" : "🗑️ Key removed",
    );
    const { text, keyboard } = buildSettingsView(user, false, locale);
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch {
      // ignore
    }
    return;
  }

  // ── Quick toggles ────────────────────────────────────────────────
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data === "settings:lang") {
    patch.locale = user.locale === "tr" ? "en" : "tr";
  } else if (data === "settings:notif") {
    patch.notificationsEnabled = !user.notificationsEnabled;
  } else if (data === "settings:datefmt") {
    const idx = DATE_FORMATS.indexOf(
      user.dateFormat as (typeof DATE_FORMATS)[number],
    );
    patch.dateFormat = DATE_FORMATS[(idx + 1) % DATE_FORMATS.length];
  } else if (data === "settings:timefmt") {
    patch.timeFormat = user.timeFormat === "24h" ? "12h" : "24h";
  } else {
    await ctx.answerCallbackQuery();
    return;
  }

  await db.update(users).set(patch).where(eq(users.id, user.id));

  const updated: SettingsUser = {
    locale: patch.locale ?? user.locale,
    timezone: user.timezone,
    dateFormat: patch.dateFormat ?? user.dateFormat,
    timeFormat: patch.timeFormat ?? user.timeFormat,
    llmModel: user.llmModel,
    notificationsEnabled:
      patch.notificationsEnabled ?? user.notificationsEnabled,
  };
  const newLocale = pickLocale(updated.locale);
  const chat = await getChatById(chatId);
  const keySet = (chat?.openrouterApiKeyEncrypted ?? null) !== null;
  const { text, keyboard } = buildSettingsView(updated, keySet, newLocale);
  await ctx.answerCallbackQuery(
    newLocale === "tr" ? "✓ Güncellendi" : "✓ Updated",
  );
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch {
    // ignore "message not modified" / uneditable
  }
}
