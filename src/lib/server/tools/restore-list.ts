/**
 * Executor: `restore_list` — undo soft-delete.
 *
 * Owner-only. Sets archived_at back to null. Items inside aren't
 * touched (delete_list never archived them); they reappear with the
 * list. 30-day window: we don't enforce a max delete-age here because
 * lists.archived_at predates F2's 30d (set in Phase 1 schema), but
 * UI-level surfacing is up to the audit page.
 */
import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listMembers, lists } from "@/lib/db/schema";
import {
  restoreListInputSchema,
  type RestoreListOutput,
} from "@/lib/ai/tools";
import { toListSnapshot } from "@/lib/db/snapshots";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRestoreList(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<RestoreListOutput>> {
  const parsed = restoreListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id } = parsed.data;

  const row = await db.query.lists.findFirst({
    where: and(
      eq(lists.id, list_id),
      eq(lists.workspaceId, ctx.workspaceId),
      isNotNull(lists.archivedAt),
    ),
  });
  if (!row) {
    return err(ERR.not_found, "No archived list found with that id.");
  }
  const owner = await db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, row.id),
      eq(listMembers.userId, ctx.userId),
      eq(listMembers.role, "owner"),
    ),
  });
  if (!owner) {
    return err(ERR.forbidden, "Only the list owner can restore the list.");
  }

  return await db.transaction(async (tx) => {
    const now = new Date();
    const listArchivedAt = row.archivedAt;

    // Cascade-restore: clear archived_at on any items archived AT THE
    // SAME TIMESTAMP as the list (i.e. archived as part of the cascade
    // delete). Items archived independently before the list-delete keep
    // their archived_at — they're the user's individual deletions, not
    // collateral from delete_list.
    let restoredItemIds: string[] = [];
    if (listArchivedAt) {
      const cascadeRows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(eq(items.listId, row.id), eq(items.archivedAt, listArchivedAt)),
        );
      restoredItemIds = cascadeRows.map((r) => r.id);
      if (restoredItemIds.length > 0) {
        await tx
          .update(items)
          .set({ archivedAt: null, updatedAt: now })
          .where(
            and(
              eq(items.listId, row.id),
              eq(items.archivedAt, listArchivedAt),
            ),
          );
      }
    }

    const [updated] = await tx
      .update(lists)
      .set({ archivedAt: null, updatedAt: now })
      .where(eq(lists.id, row.id))
      .returning();
    if (!updated) throw new Error("restore-list: update returned no row");

    await tx.insert(activityLog).values({
      listId: updated.id,
      entityType: "list",
      entityId: updated.id,
      action: "list_restored",
      actorId: ctx.userId,
      payloadBefore: toListSnapshot(row),
      payloadAfter: {
        ...toListSnapshot(updated),
        restoredItemIds,
      },
    });

    return ok({
      list: { id: updated.id, name: updated.name, emoji: updated.emoji },
    });
  });
}
