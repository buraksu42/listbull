/**
 * Bot-side i18n. Phase 1 ships TR + EN strings inline (no next-intl on the bot path).
 * Mini App uses next-intl with messages/{tr,en}.json — those are wired in Phase 4.
 */

type Locale = "tr" | "en";

const dict = {
  tr: {
    welcome: (name: string, timezone: string) =>
      `Merhaba ${name}! Ben listbull. 📥 Inbox listesini senin için oluşturdum.\n\n⏰ Saat dilimini ${timezone} olarak ayarladım. Yanlışsa bana "saat dilimi <şehir>" diye yaz (örn. "saat dilimi İstanbul"), ya da Mini App → Settings'ten değiştir.\n\nMini App'i aç, listelerini gör; ya da bana doğrudan yaz: "süt al" gibi bir mesajla bir item oluştururum.\n\nKomutlar için /help yaz.`,
    help: `Komutlar:\n/lists — listelerini göster\n/share [liste] — bir listeyi başkasıyla paylaş\n/snapshot — paylaşılabilir liste linki üret\n/reset — konuşma geçmişini sil\n/help — bu mesaj\n\nGrup komutları (bot eklenmiş grup içinde):\n/bindgroup — sahibi olduğun bir workspace'i bu grupla bağla\n/unbindgroup — bu grup'un workspace bağını kaldır\n\nDoğrudan yazarsan AI ile listenle çalışırım. Grup'ta bot'a @-mention atarak veya bir mesaja reply atıp @bot <komut> diyerek to-do açabilirsin. (OpenRouter key'i workspace sahibi tarafından Mini App → Workspace ayarları'ndan tanımlanır.)`,
    listsHeader: "Listelerin:",
    noLists: "Henüz listen yok. /start ile başla.",
    inboxLabel: "Inbox",
  },
  en: {
    welcome: (name: string, timezone: string) =>
      `Hi ${name}! I'm listbull. I've created your 📥 Inbox list.\n\n⏰ I've set your timezone to ${timezone}. If that's wrong, message me "saat dilimi <city>" (e.g. "timezone Berlin"), or change it in Mini App → Settings.\n\nOpen the Mini App to see your lists, or just message me: "buy milk" creates an item.\n\nType /help for commands.`,
    help: `Commands:\n/lists — show your lists\n/share [list] — share a list with someone\n/snapshot — generate a shareable list link\n/reset — clear conversation history\n/help — this message\n\nGroup commands (inside a group the bot is in):\n/bindgroup — bind a workspace you own to this group\n/unbindgroup — remove the workspace ↔ group binding\n\nMessage me directly and I'll work with your lists via AI. In groups, @-mention me or reply to a message with my mention + a command to turn it into a to-do. (The workspace owner sets the OpenRouter key in Mini App → Workspace settings.)`,
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
