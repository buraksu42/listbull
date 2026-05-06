/**
 * `/snapshot [list-name]` — Phase 4 / D2.
 *
 * Owner-only. Generates a public read-only snapshot URL (HMAC-signed,
 * default 30-day expiry per Inv-18) and replies with a forwardable
 * MarkdownV2 message body containing the list's CURRENT contents plus
 * an "Open snapshot" link.
 *
 * No-arg behavior: hint to the user that they need to specify which
 * list. Single-arg fuzzy match mirrors `/share`'s resolver.
 */
import type { Context } from "grammy";

import { listListsForUser } from "@/lib/db/queries/lists";
import { getUserByTelegramId } from "@/lib/db/queries/users";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { generateSnapshotMessage } from "@/lib/server/bot/snapshot";
import { pickLocale } from "@/lib/server/bot/i18n";

const COPY = {
  tr: {
    needStart: "Önce /start yaz.",
    chooseList:
      "Hangi listenin snapshot'unu paylaşmak istersin? Örn: `/snapshot alışveriş`",
    noLists: "Snapshot'u paylaşılabilir bir listen yok. Önce bir liste oluştur.",
    cantSnapshotInbox: "Inbox listesinin snapshot'u alınamaz — başka bir liste seç.",
    notOwner: "Sadece liste sahibi snapshot oluşturabilir.",
    notFound: (q: string) => `"${q}" eşleşen liste bulamadım.`,
    ambiguous: (names: string) =>
      `Birden fazla liste eşleşti: ${names}. Tam ismi yazar mısın?`,
  },
  en: {
    needStart: "Run /start first.",
    chooseList:
      "Which list do you want to snapshot? e.g. `/snapshot shopping`",
    noLists: "You have no shareable lists yet. Create one first.",
    cantSnapshotInbox: "Inbox can't be snapshotted — pick another list.",
    notOwner: "Only the list owner can take a snapshot.",
    notFound: (q: string) => `No list matched "${q}".`,
    ambiguous: (names: string) =>
      `Multiple lists matched: ${names}. Try the full name?`,
  },
} as const;

export async function handleSnapshot(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await getUserByTelegramId(from.id);
  if (!user) {
    await ctx.reply("Run /start first.");
    return;
  }
  const locale = pickLocale(user.locale);
  const copy = COPY[locale];

  const arg =
    typeof ctx.match === "string"
      ? ctx.match.trim()
      : Array.isArray(ctx.match)
        ? ctx.match.join(" ").trim()
        : "";

  if (arg.length === 0) {
    await ctx.reply(copy.chooseList, { parse_mode: "MarkdownV2" });
    return;
  }

  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const lists = await listListsForUser(user.id, workspaceId);
  // Inbox is excluded from snapshots.
  const shareable = lists.filter((l) => !l.isInbox);
  if (shareable.length === 0) {
    await ctx.reply(copy.noLists);
    return;
  }

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
    const inboxHit = lists.find(
      (l) =>
        l.isInbox &&
        (l.name.toLowerCase() === lower || lower === "inbox"),
    );
    if (inboxHit) {
      await ctx.reply(copy.cantSnapshotInbox);
      return;
    }
    await ctx.reply(copy.notFound(arg));
    return;
  }

  const result = await generateSnapshotMessage(target.id, user.id, locale);
  if (!result.ok) {
    switch (result.code) {
      case "not_found":
        await ctx.reply(copy.notFound(arg));
        return;
      case "is_inbox":
        await ctx.reply(copy.cantSnapshotInbox);
        return;
      case "forbidden":
        await ctx.reply(copy.notOwner);
        return;
    }
  }

  await ctx.reply(result.message, {
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
  });
}
