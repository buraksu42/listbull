/**
 * Executor: `cancel_invite` — revoke a PENDING list invite (owner-only).
 *
 * Mirrors `share_list`'s gates (owner-only, no Inbox, defensive list
 * resolution). Operates inside a transaction with `FOR UPDATE` on the
 * invite row so a concurrent `acceptInvite` either lands first (we
 * detect via `accepted_at IS NOT NULL` and surface
 * `invite_already_accepted` so the LLM can pivot to `remove_member`)
 * or blocks until we DELETE — both branches end in a coherent state.
 *
 * No activity_log row is written: invites aren't part of the user-
 * facing audit feed (Inv-13 — invite *creation* is also off-feed).
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listInvites, lists } from "@/lib/db/schema";
import {
  cancelInviteInputSchema,
  type CancelInviteOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, resolveList } from "./_shared";
import { isListOwner } from "@/lib/db/queries/members";

import type { ExecResult } from "./_shared";

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export async function executeCancelInvite(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CancelInviteOutput>> {
  const parsed = cancelInviteInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { username, list_id, list_name } = parsed.data;

  const lowered = normalizeUsername(username);
  if (lowered.length === 0) {
    return err(ERR.invalid_input, "username is required");
  }

  const resolution = await resolveList(
    ctx,
    { listId: list_id, listName: list_name },
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
  if (!listRow) {
    return err(ERR.not_found, "List not found.");
  }
  if (listRow.isInbox) {
    return err(ERR.invalid_input, "Inbox lists don't have invites.");
  }

  const isOwner = await isListOwner(resolution.listId, ctx.userId);
  if (!isOwner) {
    return err(ERR.forbidden, "Only the list owner can cancel invites.");
  }

  return await db.transaction(async (tx) => {
    // Lock the candidate invite row(s) for this (list, username) pair.
    // Uses raw SQL because Drizzle's query builder doesn't expose
    // `FOR UPDATE` directly on `findFirst`. We match invitedUsername
    // against the lowered form already stored at share_list time.
    const lockedRows = await tx.execute<{
      id: string;
      accepted_at: Date | null;
      expires_at: Date;
    }>(
      sql`SELECT id, accepted_at, expires_at
          FROM list_invites
          WHERE list_id = ${resolution.listId}
            AND invited_username = ${lowered}
          ORDER BY created_at DESC
          FOR UPDATE`,
    );

    if (lockedRows.length === 0) {
      return err(
        ERR.not_found,
        `No invite found for @${lowered} on this list.`,
      );
    }

    // Among matching rows, prefer a PENDING (non-accepted, non-expired)
    // one. If only an accepted row exists, surface that explicitly so
    // the LLM can pivot to remove_member.
    const now = new Date();
    const pending = lockedRows.find(
      (r) => r.accepted_at === null && r.expires_at > now,
    );
    if (!pending) {
      const accepted = lockedRows.find((r) => r.accepted_at !== null);
      if (accepted) {
        return err(
          "invite_already_accepted",
          `@${lowered} already accepted this invite — they're a member now. Use remove_member to remove them.`,
        );
      }
      // All rows are expired but unaccepted — still let the user clear them.
      const stale = lockedRows[0];
      if (!stale) {
        return err(ERR.not_found, "No pending invite found.");
      }
      await tx.delete(listInvites).where(eq(listInvites.id, stale.id));
      return ok({
        list: { id: listRow.id, name: listRow.name, emoji: listRow.emoji },
        invitedUsername: lowered,
        cancelledInviteId: stale.id,
      });
    }

    await tx.delete(listInvites).where(eq(listInvites.id, pending.id));

    return ok({
      list: { id: listRow.id, name: listRow.name, emoji: listRow.emoji },
      invitedUsername: lowered,
      cancelledInviteId: pending.id,
    });
  });
}
