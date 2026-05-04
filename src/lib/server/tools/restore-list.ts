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
import { activityLog, listMembers, lists } from "@/lib/db/schema";
import {
  restoreListInputSchema,
  type RestoreListOutput,
} from "@/lib/ai/tools";
import { toListSnapshot } from "@/lib/db/snapshots";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeRestoreList(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<RestoreListOutput>> {
  const parsed = restoreListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id } = parsed.data;

  const row = await db.query.lists.findFirst({
    where: and(eq(lists.id, list_id), isNotNull(lists.archivedAt)),
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
    const [updated] = await tx
      .update(lists)
      .set({ archivedAt: null, updatedAt: new Date() })
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
      payloadAfter: toListSnapshot(updated),
    });

    return ok({
      list: { id: updated.id, name: updated.name, emoji: updated.emoji },
    });
  });
}
