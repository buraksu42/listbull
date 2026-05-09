/**
 * Executor: `create_snapshot` — generate a public read-only snapshot
 * URL for a list. Owner-only; Inbox is rejected; expiry default 30
 * days (HMAC-signed via `SNAPSHOT_SIGNING_KEY` per Inv-18).
 *
 * Reuses the bot-side helper `generateSnapshotMessage` for parity —
 * the bot's `/snapshot` slash command and this tool both produce the
 * same URL + expiry. Only the response shape differs (slash command
 * sends a markdown body with a deeplink button; tool returns
 * machine-friendly fields the LLM can phrase any way).
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import {
  createSnapshotInputSchema,
  type CreateSnapshotOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, resolveList } from "./_shared";
import { isListOwner } from "@/lib/db/queries/members";
import { generateSnapshotUrl } from "@/lib/server/lists/snapshot-token";

import type { ExecResult } from "./_shared";

export async function executeCreateSnapshot(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CreateSnapshotOutput>> {
  const parsed = createSnapshotInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, list_name } = parsed.data;

  const resolution = await resolveList(
    ctx,
    { listId: list_id, listName: list_name },
    // Inbox cannot be snapshotted — don't fall back to it.
    { inboxFallback: false },
  );
  switch (resolution.kind) {
    case "forbidden":
      return err(ERR.forbidden, "You don't have access to that list.");
    case "not_found":
      return err(ERR.not_found, "No matching list found.");
    case "ambiguous": {
      const names = resolution.candidates.map((c) => c.name).join(", ");
      return err(
        ERR.ambiguous_list,
        `List name matched multiple lists: ${names}. Specify which one.`,
      );
    }
  }

  const [listRow] = await db
    .select({
      id: lists.id,
      name: lists.name,
      emoji: lists.emoji,
      isInbox: lists.isInbox,
    })
    .from(lists)
    .where(eq(lists.id, resolution.listId))
    .limit(1);
  if (!listRow) return err(ERR.not_found, "List not found.");
  if (listRow.isInbox) {
    return err("cannot_snapshot_inbox", "Inbox lists cannot be snapshotted.");
  }

  const isOwner = await isListOwner(resolution.listId, ctx.userId);
  if (!isOwner) {
    return err(ERR.forbidden, "Only the list owner can snapshot.");
  }

  const { url, expiresAt } = generateSnapshotUrl(resolution.listId);
  return ok({
    list: { id: listRow.id, name: listRow.name, emoji: listRow.emoji },
    url,
    expiresAt,
  });
}
