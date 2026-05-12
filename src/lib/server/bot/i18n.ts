/**
 * Bot-side i18n. Phase 1 ships TR + EN strings inline (no next-intl on the bot path).
 * Mini App uses next-intl with messages/{tr,en}.json — those are wired in Phase 4.
 */

type Locale = "tr" | "en";

const dict = {
  tr: {
    welcome: (name: string, timezone: string) =>
      `Merhaba ${name}! Ben listbull. 📥 Inbox listesini senin için oluşturdum.\n\n⏰ Saat dilimini ${timezone} olarak ayarladım. Yanlışsa bana "saat dilimi <şehir>" diye yaz (örn. "saat dilimi İstanbul"), ya da Mini App → Settings'ten değiştir.\n\nMini App'i aç, listelerini gör; ya da bana doğrudan yaz: "süt al" gibi bir mesajla bir item oluştururum.\n\nKomutlar için /help yaz.`,
    help: `Komutlar:\n/lists — listelerini göster\n/share [liste] — bir listeyi başkasıyla paylaş\n/reset — konuşma geçmişini sil\n/help — bu mesaj\n\nDoğrudan yazarsan AI ile listenle çalışırım. (OpenRouter key'i workspace sahibi tarafından Mini App → Workspace ayarları'ndan tanımlanır.)`,
    listsHeader: "Listelerin:",
    noLists: "Henüz listen yok. /start ile başla.",
    inboxLabel: "Inbox",
  },
  en: {
    welcome: (name: string, timezone: string) =>
      `Hi ${name}! I'm listbull. I've created your 📥 Inbox list.\n\n⏰ I've set your timezone to ${timezone}. If that's wrong, message me "saat dilimi <city>" (e.g. "timezone Berlin"), or change it in Mini App → Settings.\n\nOpen the Mini App to see your lists, or just message me: "buy milk" creates an item.\n\nType /help for commands.`,
    help: `Commands:\n/lists — show your lists\n/share [list] — share a list with someone\n/reset — clear conversation history\n/help — this message\n\nMessage me directly and I'll work with your lists via AI. (The workspace owner sets the OpenRouter key in Mini App → Workspace settings.)`,
    listsHeader: "Your lists:",
    noLists: "No lists yet. Run /start.",
    inboxLabel: "Inbox",
  },
} as const;

export function t(locale: Locale): (typeof dict)[Locale] {
  return dict[locale];
}

export function pickLocale(input: string | null | undefined): Locale {
  return input === "tr" ? "tr" : "en";
}
