/**
 * /onboarding — interactive walkthrough.
 *
 * One message that edits in place as the user advances through the
 * steps (avoids cluttering the chat). Each step explains a feature
 * with a concrete "try this" example; the user can run the example
 * separately (normal bot flow handles it) and tap "Devam" when ready.
 * "Atla" ends the walkthrough at any step.
 *
 * Stateless: the current step is encoded in the callback data
 * (`onboarding:step:<n>`). No DB column needed.
 *
 * Callback prefixes routed here from index.ts:
 *   onboarding:step:<n>  → render step n (1-based) in place
 *   onboarding:skip      → ends the walkthrough cleanly
 *
 * /start surfaces it via a "🎯 Hızlı tur" inline button.
 */
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";

import { getUserByTelegramId } from "@/lib/db/queries/users";
import { pickLocale } from "@/lib/server/bot/i18n";

type Step = {
  title: { tr: string; en: string };
  body: { tr: string; en: string };
};

const STEPS: Step[] = [
  {
    title: { tr: "📋 To-do ekle", en: "📋 Add a to-do" },
    body: {
      tr:
        "Bana doğal dilde yaz, listeye ekliyorum:\n" +
        "• \"süt al\"\n" +
        "• \"yarın 18'de faturayı öde\"\n\n" +
        "Hazır olunca Devam'a bas.",
      en:
        "Just type naturally, I add it to the list:\n" +
        "• \"buy milk\"\n" +
        "• \"pay the bill tomorrow 6pm\"\n\n" +
        "Hit Continue when ready.",
    },
  },
  {
    title: { tr: "📋 Listeni gör", en: "📋 See your list" },
    body: {
      tr:
        "**/items** yaz → tıklanabilir liste gelir. Her satırın altında butonlar:\n" +
        "• ☐ tamamla\n" +
        "• ✏️ düzenle  ·  🔁 tekrar  ·  📅 deadline  ·  ⏰ hatırlatıcı  ·  📎 dosya  ·  🗑️ sil",
      en:
        "Send **/items** → tappable list. Each row has buttons:\n" +
        "• ☐ complete\n" +
        "• ✏️ edit  ·  🔁 repeat  ·  📅 deadline  ·  ⏰ reminder  ·  📎 attach  ·  🗑️ delete",
    },
  },
  {
    title: { tr: "⏰ Hatırlatıcı", en: "⏰ Reminder" },
    body: {
      tr:
        "Bir item'a hatırlatıcı kur — doğal dil ya da buton:\n" +
        "• \"süt al'ı 1 saat sonra hatırlat\"\n" +
        "• /items → ⏰ butonu → \"5 dk sonra\"\n\n" +
        "Zamanı gelince DM'ine ping atarım.",
      en:
        "Set a reminder on an item — words or the button:\n" +
        "• \"remind me about the milk in 1 hour\"\n" +
        "• /items → ⏰ button → \"5 minutes\"\n\n" +
        "I'll ping your DM when it's time.",
    },
  },
  {
    title: { tr: "🔁 Tekrar eden işler", en: "🔁 Recurring tasks" },
    body: {
      tr:
        "Her gün/hafta/ay tekrar eden iş için 🔁 (kalemin yanında) ya da yaz:\n" +
        "• \"her gün 09:00 vitamin al\"\n" +
        "• \"her pazartesi 14:00 toplantı\"\n\n" +
        "Tamamladığında: orijinal satır /done'a düşer, aynı koşullarla — reminder + dosya + yeni deadline — bir kopyası /items'e otomatik açılır. \"🔁 Yeni açıldı: ...\" diye chat'e de düşer.",
      en:
        "For daily/weekly/monthly work, tap 🔁 (next to ✏️) or type:\n" +
        "• \"every day 9am vitamins\"\n" +
        "• \"every Monday 2pm standup\"\n\n" +
        "When you complete a cycle: the original drops into /done, and a fresh copy opens in /items with the same reminders + attachments + the next deadline. You also get a \"🔁 New cycle opened: …\" message in chat.",
    },
  },
  {
    title: { tr: "🗂️ Checklist", en: "🗂️ Checklist" },
    body: {
      tr:
        "Çok adımlı işleri tek başlık altında topla. Yaz:\n" +
        "\"haftalık temizlik: çamaşır, bulaşık, çöp\"\n\n" +
        "→ Parent + 3 alt-item. /items'ta 📂 ile gözükür, tıklayıp içine girersin. Tüm alt'lar ✅ olunca parent kendi kapanır.",
      en:
        "Group multi-step work under one umbrella. Try:\n" +
        "\"weekly cleaning: laundry, dishes, trash\"\n\n" +
        "→ Parent + 3 sub-items. Shows as 📂 in /items; tap to drill in. When every sub is ✅, the parent closes itself.",
    },
  },
  {
    title: { tr: "🏷️ Etiketler & atama", en: "🏷️ Tags & assignment" },
    body: {
      tr:
        "Etiketle ya da birine ata (atama = etiket):\n" +
        "• \"ekmek al #market\"\n" +
        "• \"raporu Michael'a ata\" → #michael etiketi\n\n" +
        "**/tag market** veya **/tag michael** → o etiketin açık işleri.",
      en:
        "Tag, or assign (assignment = tag):\n" +
        "• \"buy bread #shopping\"\n" +
        "• \"assign the report to Michael\" → #michael tag\n\n" +
        "**/tag shopping** or **/tag michael** → open items under that tag.",
    },
  },
  {
    title: { tr: "📁 Hafıza", en: "📁 Memory" },
    body: {
      tr:
        "Kalıcı saklamak istediklerin: biletler, dökümanlar, kayıtlar. Yaz:\n" +
        "\"konser biletlerini hafızaya al\"\n\n" +
        "**/memory** ile listele. Auto-silinmez; silmek için açık onay ister.",
      en:
        "For keepsakes — tickets, docs, receipts. Try:\n" +
        "\"save the concert tickets to memory\"\n\n" +
        "List with **/memory**. Never auto-deleted; removal needs explicit confirmation.",
    },
  },
  {
    title: { tr: "🔒 Şifre · ⚙️ Ayarlar", en: "🔒 Password · ⚙️ Settings" },
    body: {
      tr:
        "**/password** (DM'de) — şifrelerini AES-256-GCM ile sakla. \"gmail şifresi ne?\" dediğinde 15 sn'lik geçici mesajla yollar.\n\n" +
        "**/settings** — dil, bildirim, tarih biçimi + kendi OpenRouter key'in (varsa) — hepsi tek ekrandan.",
      en:
        "**/password** (in DM) — store credentials AES-256-GCM encrypted. \"what's the gmail password?\" sends a 15-sec self-destruct message.\n\n" +
        "**/settings** — language, notifications, date format + your own OpenRouter key (if any) — all from one screen.",
    },
  },
  {
    title: { tr: "🎤 Sesli mesaj", en: "🎤 Voice notes" },
    body: {
      tr:
        "DM'de sesli not at, transcribe edip işlerim (kendi key'in varsa).\n\n" +
        "Gruplarda da herkesin attığı sesi dinlerim — içinde iş varsa listeye düşer, yoksa sessiz kalırım.",
      en:
        "Send voice notes in DM — I transcribe and act on them (when you have your own key).\n\n" +
        "In groups, I listen to every voice note — if there's a to-do in it, I add it; otherwise I stay silent.",
    },
  },
];

function renderStep(
  stepIdx: number,
  locale: "tr" | "en",
): { text: string; keyboard: InlineKeyboard } {
  const step = STEPS[stepIdx]!;
  const total = STEPS.length;
  const tr = locale === "tr";
  const header = tr
    ? `🎯 ${stepIdx + 1}/${total} — ${step.title.tr}`
    : `🎯 ${stepIdx + 1}/${total} — ${step.title.en}`;
  const text = `${header}\n\n${tr ? step.body.tr : step.body.en}`;
  const keyboard = new InlineKeyboard();
  if (stepIdx + 1 < total) {
    keyboard
      .text(tr ? "Devam ▶" : "Continue ▶", `onboarding:step:${stepIdx + 1}`)
      .text(tr ? "Atla ✗" : "Skip ✗", "onboarding:skip");
  } else {
    keyboard.text(tr ? "Bitir ✓" : "Finish ✓", "onboarding:skip");
  }
  return { text, keyboard };
}

function renderIntro(locale: "tr" | "en"): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const tr = locale === "tr";
  const text = tr
    ? `🎯 listbull turu — ${STEPS.length} adım, ~3 dk.\n\nHer adımda kısa bir şey dener, hazır olunca **Devam**'a basarsın. İstediğin an **Atla** ile çıkabilirsin.`
    : `🎯 listbull tour — ${STEPS.length} steps, ~3 min.\n\nEach step has a quick thing to try; hit **Continue** when ready. **Skip** ends the tour anytime.`;
  const keyboard = new InlineKeyboard()
    .text(tr ? "Başla ▶" : "Start ▶", "onboarding:step:0")
    .text(tr ? "Atla ✗" : "Skip ✗", "onboarding:skip");
  return { text, keyboard };
}

export async function handleOnboarding(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message = ctx.message;
  if (!from || !message) return;
  const user = await getUserByTelegramId(from.id);
  const locale = pickLocale(user?.locale);
  const { text, keyboard } = renderIntro(locale);
  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
}

export async function handleOnboardingCallback(ctx: Context): Promise<void> {
  const cb = ctx.callbackQuery;
  if (!cb || typeof cb.data !== "string") return;
  const data = cb.data;
  if (!data.startsWith("onboarding:")) return;

  const user = await getUserByTelegramId(cb.from.id);
  const locale = pickLocale(user?.locale);

  if (data === "onboarding:skip") {
    await ctx.answerCallbackQuery(
      locale === "tr" ? "Tur kapatıldı" : "Tour closed",
    );
    const text =
      locale === "tr"
        ? "✨ Tamam, çıktın. İstediğin zaman **/onboarding** ile baştan başlatabilirsin. **/help** ile tüm komutlar."
        : "✨ Walkthrough closed. Run **/onboarding** anytime to restart. **/help** for the full command list.";
    try {
      await ctx.editMessageText(text, { parse_mode: "Markdown" });
    } catch {
      // ignore — message uneditable or unchanged
    }
    return;
  }

  if (data.startsWith("onboarding:step:")) {
    const n = Number.parseInt(data.slice("onboarding:step:".length), 10);
    if (!Number.isFinite(n) || n < 0 || n >= STEPS.length) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const { text, keyboard } = renderStep(n, locale);
    try {
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    } catch {
      // ignore
    }
    return;
  }

  await ctx.answerCallbackQuery();
}
