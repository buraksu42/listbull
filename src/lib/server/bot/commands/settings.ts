/**
 * /settings — view + change preferences via inline buttons.
 *
 * One-tap toggles: language (tr⇄en), notifications, date/time format.
 * Model picker is a dedicated sub-view (too many options for a toggle).
 * Timezone is still read-only (huge IANA list — natural-language only).
 * OpenRouter key: shows whether the chat has its own key; a button
 * starts the key-paste flow (DM force-reply; in a group the owner is
 * DMed). Key removal drops the chat back to the free tier.
 *
 * Callback prefixes (routed in index.ts → handleSettingsCallback):
 *   settings:lang | settings:notif | settings:datefmt | settings:timefmt
 *   settings:key       → start key-set flow
 *   settings:keyremove → clear the chat's key (owner-only in groups)
 *   settings:modelmenu → open the model picker sub-view
 *   settings:m:<i>     → select model at index i in ALLOWED_LLM_MODELS
 *   settings:back      → return from a sub-view to the main settings
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
import {
  ALLOWED_LLM_MODELS,
  LLM_MODEL_META,
  type AllowedLlmModel,
} from "@/lib/validators/settings";

const DATE_FORMATS = ["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

type SettingsUser = {
  locale: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  llmModel: string;
  notificationsEnabled: boolean;
};

/** Pretty short name for the model line. Falls back to the raw slug
 * if a stored model was removed from `ALLOWED_LLM_MODELS` between
 * deploys (don't surface the index — slug is more debuggable). */
function modelLabel(slug: string): string {
  const meta = (LLM_MODEL_META as Record<string, { label: string } | undefined>)[
    slug
  ];
  return meta ? `${meta.label}` : slug;
}

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

  // Free tier ignores `users.llmModel` and forces `env.LISTBULL_FREE_MODEL`
  // in handle-message.ts. Reflect that here so the picker isn't misleading
  // — on free tier we hide the choice and tell the user how to unlock it.
  const modelLine = keySet
    ? tr
      ? `🤖 Model: ${modelLabel(u.llmModel)}`
      : `🤖 Model: ${modelLabel(u.llmModel)}`
    : tr
      ? "🤖 Model: ücretsiz tier (kendi OpenRouter key'inle seçim açılır)"
      : "🤖 Model: free tier (add your OpenRouter key to choose)";

  const lines = tr
    ? [
        "⚙️ Ayarlar",
        "",
        `🌐 Dil: ${langName}`,
        `🔔 Bildirimler: ${notifOn ? "Açık" : "Kapalı"}`,
        `📅 Tarih biçimi: ${u.dateFormat}`,
        `⏰ Saat biçimi: ${u.timeFormat}`,
        `🕐 Saat dilimi: ${u.timezone}`,
        modelLine,
        keyLine,
        "",
        "Saat dilimi için yaz: \"saat dilimi İstanbul\".",
      ]
    : [
        "⚙️ Settings",
        "",
        `🌐 Language: ${langName}`,
        `🔔 Notifications: ${notifOn ? "On" : "Off"}`,
        `📅 Date format: ${u.dateFormat}`,
        `⏰ Time format: ${u.timeFormat}`,
        `🕐 Timezone: ${u.timezone}`,
        modelLine,
        keyLine,
        "",
        "For timezone, just say: \"timezone Istanbul\".",
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
    .row();
  // Model picker only makes sense when the chat has its own OpenRouter
  // key — free tier ignores user.llmModel (see handle-message.ts). On
  // free tier we hide the button; the body line already explains why.
  if (keySet) {
    keyboard
      .text(tr ? "🤖 Modeli değiştir" : "🤖 Change model", "settings:modelmenu")
      .row();
  }
  keyboard
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

/**
 * Model picker sub-view. Lists every allowed model as a 2-column grid
 * grouped by provider; the user's current model is marked with a "•"
 * prefix. Callback data is `settings:m:<index>` to stay well under
 * Telegram's 64-byte cap (slugs alone are up to 33 chars, prefix would
 * push some over once provider grouping changes).
 */
function buildModelPickerView(
  currentModel: string,
  locale: "tr" | "en",
): { text: string; keyboard: InlineKeyboard } {
  const tr = locale === "tr";
  const currentLabel = modelLabel(currentModel);

  const lines = tr
    ? [
        "🤖 Model seçimi",
        "",
        `Şu an: ${currentLabel}`,
        "",
        "Bir model seç — değişiklik anında geçerli olur.",
        "Ücretsiz tier'da güçlü modeller için /settings → 🔑 ile OpenRouter key ekle.",
      ]
    : [
        "🤖 Pick a model",
        "",
        `Current: ${currentLabel}`,
        "",
        "Tap to switch — applies immediately.",
        "On the free tier? Add an OpenRouter key from /settings → 🔑 to unlock the stronger models.",
      ];

  const keyboard = new InlineKeyboard();
  // 2-column grid, grouped order from ALLOWED_LLM_MODELS (provider
  // blocks are contiguous there). Mark the current pick with "•".
  let col = 0;
  ALLOWED_LLM_MODELS.forEach((slug, idx) => {
    const meta = LLM_MODEL_META[slug as AllowedLlmModel];
    const isCurrent = slug === currentModel;
    const label = `${isCurrent ? "• " : ""}${meta.label}`;
    keyboard.text(label, `settings:m:${idx}`);
    col += 1;
    if (col === 2) {
      keyboard.row();
      col = 0;
    }
  });
  if (col !== 0) keyboard.row();
  keyboard.text(tr ? "← Geri" : "← Back", "settings:back");

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

  // ── Model picker: open sub-view ─────────────────────────────────
  if (data === "settings:modelmenu") {
    // Free-tier guard: the button is hidden on free tier, but stale
    // keyboards from before a key was removed can still fire this —
    // refuse with a toast and re-render the main view.
    const chatRow = await getChatById(chatId);
    if ((chatRow?.openrouterApiKeyEncrypted ?? null) === null) {
      await ctx.answerCallbackQuery(
        locale === "tr"
          ? "Model seçimi için OpenRouter key gerekli"
          : "Model picker requires an OpenRouter key",
      );
      const { text, keyboard } = buildSettingsView(user, false, locale);
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch {
        // ignore
      }
      return;
    }
    await ctx.answerCallbackQuery();
    const { text, keyboard } = buildModelPickerView(user.llmModel, locale);
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch {
      // ignore "message not modified" / uneditable
    }
    return;
  }

  // ── Model picker: back to main settings (no mutation) ───────────
  if (data === "settings:back") {
    await ctx.answerCallbackQuery();
    const chat = await getChatById(chatId);
    const keySet = (chat?.openrouterApiKeyEncrypted ?? null) !== null;
    const { text, keyboard } = buildSettingsView(user, keySet, locale);
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch {
      // ignore
    }
    return;
  }

  // ── Model picker: select a model by index ───────────────────────
  if (data.startsWith("settings:m:")) {
    // Same free-tier guard as the menu opener (key may have been
    // removed since this keyboard was rendered).
    const chatRow = await getChatById(chatId);
    if ((chatRow?.openrouterApiKeyEncrypted ?? null) === null) {
      await ctx.answerCallbackQuery(
        locale === "tr"
          ? "Model seçimi için OpenRouter key gerekli"
          : "Model picker requires an OpenRouter key",
      );
      const { text, keyboard } = buildSettingsView(user, false, locale);
      try {
        await ctx.editMessageText(text, { reply_markup: keyboard });
      } catch {
        // ignore
      }
      return;
    }
    const idxRaw = data.slice("settings:m:".length);
    const idx = Number.parseInt(idxRaw, 10);
    if (
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= ALLOWED_LLM_MODELS.length
    ) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Geçersiz model" : "Invalid model",
      );
      return;
    }
    // `noUncheckedIndexedAccess` widens the lookup to `… | undefined`;
    // the range guard above already ruled that out — narrow explicitly.
    const newModel = ALLOWED_LLM_MODELS[idx];
    if (!newModel) {
      await ctx.answerCallbackQuery(
        locale === "tr" ? "Geçersiz model" : "Invalid model",
      );
      return;
    }
    if (newModel !== user.llmModel) {
      await db
        .update(users)
        .set({ llmModel: newModel, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    await ctx.answerCallbackQuery(
      locale === "tr"
        ? `✓ Model: ${LLM_MODEL_META[newModel].label}`
        : `✓ Model: ${LLM_MODEL_META[newModel].label}`,
    );
    // Re-render the main settings view with the updated model.
    const refreshed: SettingsUser = {
      locale: user.locale,
      timezone: user.timezone,
      dateFormat: user.dateFormat,
      timeFormat: user.timeFormat,
      llmModel: newModel,
      notificationsEnabled: user.notificationsEnabled,
    };
    // Reuse the chatRow fetched for the free-tier guard above — at
    // this point `keySet` is necessarily true.
    const { text, keyboard } = buildSettingsView(refreshed, true, locale);
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
