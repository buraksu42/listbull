/**
 * Bot-side i18n (Phase 17 chat-only).
 *
 * Command order in `help` MUST match `setMyCommands` in
 * `src/lib/server/bot/index.ts` — drift confuses users hitting the
 * Telegram menu and then asking `/help`.
 */

type Locale = "tr" | "en";

const dict = {
  tr: {
    welcome: (name: string, timezone: string) =>
      `Merhaba ${name}! Ben listbull.\n\n📋 Bu chat = bir to-do listesi. Bana doğal dilde yaz, ben işini görüyorum:\n• "süt al"\n• "Alex'e toplantı notlarını gönder, yarın 14:00'da hatırlat"\n• "/items" → tüm item'ları göster\n• "/onboarding" → 3 dk'lık hızlı tur\n\n⏰ Saat dilimin ${timezone}. Yanlışsa "saat dilimi <şehir>" yaz.\n\n🆓 Ücretsiz başlıyorsun — denemen için **saatte 100 mesaj** veriyorum, sesli not kapalı, model kalitesi sınırlı. Sınırsız + güçlü modeller + ses için kendi OpenRouter key'ini /settings → 🔑 ile ekleyebilirsin (openrouter.ai/keys).`,
    help: `Komutlar:\n📋 /items — açık to-do'lar\n✅ /done — tamamlananlar (geri açabilir veya arşivleyebilirsin)\n📁 /memory — hafıza (biletler, dökümanlar — silinmez)\n🏷️ /tag <etiket> — etikete göre işler (örn. /tag michael)\n📅 /today — bugün için planlananlar\n🗓 /thisweek — bu haftaki işler\n🔔 /reminders — bekleyen hatırlatıcılar\n🔒 /password — şifre sakla / görüntüle (DM)\n⚙️ /settings — dil, bildirim, biçim, OpenRouter key\n🎯 /onboarding — hızlı tur (yeni misin?)\n❓ /help — bu mesaj\n🧹 /reset — konuşma geçmişini sil\n\nİkon rehberi:\n📅 ileride deadline   ⏳ deadline 24 saat içinde   ⚠️ deadline geçmiş\n🔔 aktif hatırlatıcı var   📎 dosya/foto eki   📌 memory marker\n📂 checklist (parent + alt-item'lar)   🔥 yüksek öncelik   💤 düşük öncelik   ⏸️ blokta   ✅ tamamlandı\n\nButonlar: ✏️ düzenle · 📅 deadline kur · ⏰ hatırlatıcı kur · 📎 dosya · 🗑️ sil · 📂 alt-item'lar\n\nSesli not gönderebilirsin — transkripte edip listeye eklerim. Gruplarda da dinlerim, içinde to-do varsa düşer.`,
  },
  en: {
    welcome: (name: string, timezone: string) =>
      `Hi ${name}! I'm listbull.\n\n📋 This chat = a to-do list. Talk naturally:\n• "buy milk"\n• "send meeting notes to @alex, remind me tomorrow 2pm"\n• "/items" → show all items\n• "/onboarding" → 3-minute quick walkthrough\n\n⏰ Your timezone is ${timezone}. Wrong? Say "timezone <city>".\n\n🆓 Starting free — you get **100 messages/hour** for a trial, voice notes off, limited model quality. For unlimited + stronger models + voice, add your OpenRouter key via /settings → 🔑 (openrouter.ai/keys).`,
    help: `Commands:\n📋 /items — open to-dos\n✅ /done — completed items (reopen or archive)\n📁 /memory — memory keepsakes (tickets, docs — never auto-deleted)\n🏷️ /tag <name> — items by tag (e.g. /tag michael)\n📅 /today — what's on for today\n🗓 /thisweek — items due this week\n🔔 /reminders — pending reminders\n🔒 /password — store / reveal passwords (DM)\n⚙️ /settings — language, notifications, formats, OpenRouter key\n🎯 /onboarding — quick walkthrough (new here?)\n❓ /help — this message\n🧹 /reset — clear conversation history\n\nIcon legend:\n📅 future deadline   ⏳ deadline within 24h   ⚠️ overdue\n🔔 has active reminder   📎 attachment   📌 memory marker\n📂 checklist (parent + sub-items)   🔥 high priority   💤 low priority   ⏸️ blocked   ✅ done\n\nButtons: ✏️ edit · 📅 set deadline · ⏰ set reminder · 📎 attach · 🗑️ delete · 📂 sub-items\n\nVoice notes work — I transcribe and add what's actionable. In groups I listen ambiently; only to-dos surface.`,
  },
} as const;

export function t(locale: Locale): (typeof dict)[Locale] {
  return dict[locale];
}

export function pickLocale(input: string | null | undefined): Locale {
  return input === "tr" ? "tr" : "en";
}
