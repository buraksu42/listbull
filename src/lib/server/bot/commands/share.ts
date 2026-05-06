/**
 * `/share [list-name]` — open the Mini App share sheet for the named
 * (or selected) list. Sub-100ms target; no LLM call. If no arg, reply
 * with deeplinks for the user's lists. If a single list resolves,
 * deeplink directly to its Mini App page where the share sheet lives.
 */
import type { Context } from "grammy";

import { listListsForUser } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { pickLocale } from "@/lib/server/bot/i18n";
import { env } from "@/lib/env";

const COPY = {
  tr: {
    needStart: "Önce /start yaz.",
    chooseList: "Hangi listeyi paylaşmak istersin?",
    noLists: "Paylaşacak listen yok. Önce bir liste oluştur.",
    cantShareInbox: "Inbox listesi paylaşılamaz — başka bir liste seç.",
    notFound: (q: string) => `"${q}" eşleşen liste bulamadım.`,
    ambiguous: (names: string) =>
      `Birden fazla liste eşleşti: ${names}. Tam ismi yazar mısın?`,
    openShare: (name: string) => `*${name}* için paylaşım ekranı:`,
  },
  en: {
    needStart: "Run /start first.",
    chooseList: "Which list do you want to share?",
    noLists: "You have no lists to share yet. Create one first.",
    cantShareInbox: "Inbox can't be shared — pick another list.",
    notFound: (q: string) => `No list matched "${q}".`,
    ambiguous: (names: string) =>
      `Multiple lists matched: ${names}. Try the full name?`,
    openShare: (name: string) => `Share sheet for *${name}*:`,
  },
} as const;

export async function handleShare(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }

  const locale = pickLocale(user.locale);
  const copy = COPY[locale];

  // grammY surfaces command args via ctx.match for `bot.command()`.
  const arg =
    typeof ctx.match === "string"
      ? ctx.match.trim()
      : Array.isArray(ctx.match)
        ? ctx.match.join(" ").trim()
        : "";

  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const lists = await listListsForUser(user.id, workspaceId);
  // Exclude Inbox — it cannot be shared.
  const shareable = lists.filter((l) => !l.isInbox);

  if (shareable.length === 0) {
    await ctx.reply(copy.noLists);
    return;
  }

  // No arg → list shareable lists with deeplinks.
  if (arg.length === 0) {
    const header = `*${escapeMarkdownV2(copy.chooseList)}*`;
    const lines = shareable.map((list) => {
      const emoji = list.emoji ?? "📋";
      const deeplink = `${env.NEXT_PUBLIC_APP_URL}/lists/${list.id}?share=1`;
      return `${escapeMarkdownV2(emoji)} [${escapeMarkdownV2(list.name)}](${deeplink})`;
    });
    await ctx.reply([header, ...lines].join("\n"), {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  // Argument supplied → resolve.
  const lower = arg.toLowerCase();
  const exact = shareable.filter((l) => l.name.toLowerCase() === lower);
  let target = exact.length === 1 ? exact[0] : null;
  if (!target) {
    const fuzzy = shareable.filter((l) =>
      l.name.toLowerCase().includes(lower),
    );
    if (fuzzy.length === 1) {
      target = fuzzy[0];
    } else if (fuzzy.length > 1) {
      const names = fuzzy.map((l) => l.name).join(", ");
      await ctx.reply(copy.ambiguous(names));
      return;
    }
  }

  if (!target) {
    // Could be Inbox — friendlier hint.
    const inboxHit = lists.find(
      (l) =>
        l.isInbox &&
        (l.name.toLowerCase() === lower || lower === "inbox"),
    );
    if (inboxHit) {
      await ctx.reply(copy.cantShareInbox);
      return;
    }
    await ctx.reply(copy.notFound(arg));
    return;
  }

  const emoji = target.emoji ?? "📋";
  const deeplink = `${env.NEXT_PUBLIC_APP_URL}/lists/${target.id}?share=1`;
  const message = [
    copy.openShare(escapeMarkdownV2(`${emoji} ${target.name}`)),
    `[${escapeMarkdownV2(target.name)}](${deeplink})`,
  ].join("\n");

  await ctx.reply(message, {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  });
}
