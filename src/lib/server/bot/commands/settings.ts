/**
 * /settings — view + change user preferences via inline buttons.
 *
 * Quick-toggle settings (locale, notifications, date/time format) are
 * one tap. Timezone + LLM model are shown read-only with a hint to
 * change them via chat ("saat dilimi İstanbul", "modeli değiştir") —
 * they need free-text / a preset list, awkward as buttons.
 *
 * Callback prefixes (routed in index.ts → handleSettingsCallback):
 *   settings:lang      → toggle tr ⇄ en
 *   settings:notif     → toggle notifications on/off
 *   settings:datefmt   → cycle DD.MM.YYYY → MM/DD/YYYY → YYYY-MM-DD
 *   settings:timefmt   → toggle 24h ⇄ 12h
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getUserByTelegramId } from "@/lib/db/queries/users";
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
  locale: "tr" | "en",
): { text: string; keyboard: InlineKeyboard } {
  const tr = locale === "tr";
  const langName = u.locale === "tr" ? "Türkçe" : "English";
  const notifOn = u.notificationsEnabled;

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
        "",
        "For timezone / model, just say: \"timezone Istanbul\", \"change the model\".",
      ];

  const keyboard = new InlineKeyboard()
    .text(
      tr
        ? `🌐 Dil → ${u.locale === "tr" ? "English" : "Türkçe"}`
        : `🌐 Language → ${u.locale === "tr" ? "English" : "Türkçe"}`,
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
      tr
        ? `⏰ Saat → ${u.timeFormat === "24h" ? "12h" : "24h"}`
        : `⏰ Time → ${u.timeFormat === "24h" ? "12h" : "24h"}`,
      "settings:timefmt",
    );

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
  const { text, keyboard } = buildSettingsView(user, locale);
  await ctx.reply(text, { reply_markup: keyboard });
}

/** Routes `settings:*` callback taps. Registered from index.ts. */
export async function handleSettingsCallback(ctx: Context): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  const data = cb.data;
  if (!data.startsWith("settings:")) return;

  const user = await getUserByTelegramId(cb.from.id);
  if (!user) {
    await ctx.answerCallbackQuery("Run /start first.");
    return;
  }

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

  // Re-render with the post-update values.
  const updated: SettingsUser = {
    locale: patch.locale ?? user.locale,
    timezone: user.timezone,
    dateFormat: patch.dateFormat ?? user.dateFormat,
    timeFormat: patch.timeFormat ?? user.timeFormat,
    llmModel: user.llmModel,
    notificationsEnabled:
      patch.notificationsEnabled ?? user.notificationsEnabled,
  };
  const locale = pickLocale(updated.locale);
  const { text, keyboard } = buildSettingsView(updated, locale);
  await ctx.answerCallbackQuery(locale === "tr" ? "✓ Güncellendi" : "✓ Updated");
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch {
    // ignore "message not modified" / uneditable
  }
}
