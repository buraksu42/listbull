/**
 * Bot-side i18n (Phase 17 chat-only).
 */

type Locale = "tr" | "en";

const dict = {
  tr: {
    welcome: (name: string, timezone: string) =>
      `Merhaba ${name}! Ben listbull.\n\n📋 Bu chat = bir to-do listesi. Bana doğal dilde yaz, ben işini görüyorum:\n• "süt al"\n• "Ali'ye toplantı notlarını gönder, yarın 14:00'da hatırlat"\n• "/items" → tüm item'ları göster\n\n⏰ Saat dilimin ${timezone}. Yanlışsa "saat dilimi <şehir>" yaz.\n\n🔑 Önce OpenRouter key gerek (chat sahibi olarak): openrouter.ai/keys → key oluştur → buraya yapıştır.`,
    help: `Komutlar:\n📋 /items — to-do'ları göster (inline butonlarla)\n📁 /memory — hafızadakileri göster (biletler, dökümanlar — silinmez)\n📅 /today — bugün için planlananlar\n🗓 /thisweek — bu haftaki işler\n👤 /assigned [@kullanıcı] — atanan işler (boş bırakırsan sana atananlar)\n🔔 /reminders — bekleyen hatırlatıcılar\n🧹 /reset — konuşma geçmişini sil\n❓ /help — bu mesaj\n\nDoğrudan yazarsan AI ile chat'in listesi üzerinde çalışırım. OpenRouter key'i direkt buraya yapıştır — kaydederim, mesajını silerim.`,
  },
  en: {
    welcome: (name: string, timezone: string) =>
      `Hi ${name}! I'm listbull.\n\n📋 This chat = a to-do list. Talk naturally:\n• "buy milk"\n• "send meeting notes to @ali, remind me tomorrow 2pm"\n• "/items" → show all items\n\n⏰ Your timezone is ${timezone}. Wrong? Say "timezone <city>".\n\n🔑 You need an OpenRouter key (as chat owner): openrouter.ai/keys → create key → paste it here.`,
    help: `Commands:\n📋 /items — show to-dos (with inline buttons)\n📁 /memory — show memory keepsakes (tickets, docs — never auto-deleted)\n📅 /today — what's on for today\n🗓 /thisweek — items due this week\n👤 /assigned [@user] — assigned items (defaults to you)\n🔔 /reminders — pending reminders\n🧹 /reset — clear conversation history\n❓ /help — this message\n\nMessage me naturally and I'll work the chat's list via AI. Paste your OpenRouter API key here — I save it and delete the message.`,
  },
} as const;

export function t(locale: Locale): (typeof dict)[Locale] {
  return dict[locale];
}

export function pickLocale(input: string | null | undefined): Locale {
  return input === "tr" ? "tr" : "en";
}
