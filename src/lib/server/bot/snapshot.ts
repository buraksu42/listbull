/**
 * D2 — bot-side snapshot message generator (Phase 4).
 *
 * Produces a forwardable Telegram MarkdownV2 message body containing
 * the list's CURRENT contents + a deeplink button to the public
 * snapshot page (HMAC-signed, default 30-day expiry per Inv-18).
 *
 * Owner-only. Inbox cannot be snapshotted (`getSnapshotPublic` returns
 * null in that case). Caller (slash command handler) handles "list not
 * found / not yours" UX in the user's locale.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { getSnapshotPublic } from "@/lib/db/queries/snapshots";
import { isListOwner } from "@/lib/db/queries/members";
import { escapeMarkdownV2 } from "@/lib/server/bot/escape-markdown";
import { generateSnapshotUrl } from "@/lib/server/lists/snapshot-token";

export type SnapshotMessageOk = {
  ok: true;
  message: string;
  url: string;
  /** Bare list id; bot replies sometimes inline-keyboard against this. */
  listId: string;
  expiresAt: string;
};

export type SnapshotMessageErr = {
  ok: false;
  code: "not_found" | "forbidden" | "is_inbox";
};

/**
 * Build a forwardable MarkdownV2-formatted message body for a list.
 *
 * Owner-only; non-owners get `forbidden`. Inbox lists get `is_inbox`
 * so the slash command can phrase the rejection cleanly. Missing or
 * archived lists get `not_found`.
 */
export async function generateSnapshotMessage(
  listId: string,
  ownerId: string,
  locale: "tr" | "en",
): Promise<SnapshotMessageOk | SnapshotMessageErr> {
  // Existence + inbox guard before owner check (don't leak ownership
  // details about lists the caller has zero membership on).
  const [listRow] = await db
    .select({ isInbox: lists.isInbox })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!listRow) return { ok: false, code: "not_found" };
  if (listRow.isInbox) return { ok: false, code: "is_inbox" };

  const isOwner = await isListOwner(listId, ownerId);
  if (!isOwner) return { ok: false, code: "forbidden" };

  const { url, expiresAt } = generateSnapshotUrl(listId);

  // Build the snapshot body using the read-side query so the bot
  // message + the public page show the same content this instant.
  const snapshot = await getSnapshotPublic(listId, expiresAt);
  if (!snapshot) return { ok: false, code: "not_found" };

  const emoji = snapshot.listEmoji ?? "📋";
  const heading = escapeMarkdownV2(`${emoji} ${snapshot.listName}`);
  const itemLines = snapshot.items.slice(0, 50).map((it) => {
    const bullet = it.isDone ? "✅" : "▫️";
    return `${bullet} ${escapeMarkdownV2(it.text)}`;
  });
  const overflow = snapshot.items.length > 50;
  const footer =
    locale === "tr"
      ? `[Snapshot'u tarayıcıda aç](${url})`
      : `[Open snapshot in browser](${url})`;
  const overflowNote = overflow
    ? locale === "tr"
      ? `\n_… ${snapshot.items.length - 50} öğe daha snapshot'ta_`
      : `\n_… ${snapshot.items.length - 50} more items in the snapshot_`
    : "";

  const body =
    `*${heading}*\n\n` +
    (itemLines.length > 0
      ? itemLines.join("\n")
      : locale === "tr"
        ? "_Liste boş_"
        : "_List is empty_") +
    `${overflowNote}\n\n${footer}`;

  return {
    ok: true,
    message: body,
    url,
    listId,
    expiresAt,
  };
}
