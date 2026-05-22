/**
 * Bot-side i18n (Phase 17 chat-only).
 */

type Locale = "tr" | "en";

const dict = {
  tr: {
    welcome: (name: string, timezone: string) =>
      `Merhaba ${name}! Ben listbull.\n\n📋 Bu chat = bir to-do listesi. Bana doğal dilde yaz, ben işini görüyorum:\n• "süt al"\n• "Ali'ye toplantı notlarını gönder, yarın 14:00'da hatırlat"\n• "/items" → tüm item'ları göster\n\n⏰ Saat dilimin ${timezone}. Yanlışsa "saat dilimi <şehir>" yaz.\n\n🔑 Önce OpenRouter key gerek (chat sahibi olarak): openrouter.ai/keys → key oluştur → buraya yapıştır.`,
    help: `Komutlar:\n📋 /items — açık to-do'lar\n✅ /done — tamamlananlar (geri açabilir veya arşivleyebilirsin)\n📁 /memory — hafıza (biletler, dökümanlar — silinmez)\n🔒 /password — şifre saklama (sadece DM)\n📅 /today — bugün için planlananlar\n🗓 /thisweek — bu haftaki işler\n🏷️ /tag <etiket> — etikete göre işler (örn. /tag burak)\n🔔 /reminders — bekleyen hatırlatıcılar\n⚙️ /settings — dil, bildirim, biçim ayarları\n🧹 /reset — konuşma geçmişini sil\n❓ /help — bu mesaj\n\nİkon rehberi:\n📅 ileride deadline   ⏳ deadline 24 saat içinde   ⚠️ deadline geçmiş\n🔔 aktif hatırlatıcı var   📎 dosya/foto eki   📌 memory marker\n🔥 yüksek öncelik   💤 düşük öncelik   ⏸️ blokta   ✅ tamamlandı\n\nButonlar: ✏️ düzenle · 📅 deadline kur · ⏰ hatırlatıcı kur · 📎 dosya · 🗑️ sil\n\nDoğrudan yazarsan AI ile çalışırım.`,
  },
  en: {
    welcome: (name: string, timezone: string) =>
      `Hi ${name}! I'm listbull.\n\n📋 This chat = a to-do list. Talk naturally:\n• "buy milk"\n• "send meeting notes to @ali, remind me tomorrow 2pm"\n• "/items" → show all items\n\n⏰ Your timezone is ${timezone}. Wrong? Say "timezone <city>".\n\n🔑 You need an OpenRouter key (as chat owner): openrouter.ai/keys → create key → paste it here.`,
    help: `Commands:\n📋 /items — open to-dos\n✅ /done — completed items (reopen or archive)\n📁 /memory — memory keepsakes (tickets, docs — never auto-deleted)\n🔒 /password — password storage (DM-only)\n📅 /today — what's on for today\n🗓 /thisweek — items due this week\n🏷️ /tag <name> — items by tag (e.g. /tag burak)\n🔔 /reminders — pending reminders\n⚙️ /settings — language, notifications, formats\n🧹 /reset — clear conversation history\n❓ /help — this message\n\nIcon legend:\n📅 future deadline   ⏳ deadline within 24h   ⚠️ overdue\n🔔 has active reminder   📎 attachment   📌 memory marker\n🔥 high priority   💤 low priority   ⏸️ blocked   ✅ done\n\nButtons: ✏️ edit · 📅 set deadline · ⏰ set reminder · 📎 attach · 🗑️ delete`,
  },
} as const;

export function t(locale: Locale): (typeof dict)[Locale] {
  return dict[locale];
}

export function pickLocale(input: string | null | undefined): Locale {
  return input === "tr" ? "tr" : "en";
}
