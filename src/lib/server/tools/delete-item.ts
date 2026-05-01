/**
 * Executor: `delete_item`. Soft-delete only (`archived_at = now()`).
 *
 * activity_log row: action='item_deleted',
 *   payload_before = pre-archive snapshot,
 *   payload_after  = null (per Inv-5).
 *
 * Already-archived items return `not_found` so the LLM can't double-delete.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  deleteItemInputSchema,
  type DeleteItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeDeleteItem(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<DeleteItemOutput>> {
  const parsed = deleteItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current || current.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }

    const allowed = await userCanWriteList(ctx.userId, current.listId);
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const now = new Date();
    const snapshotBefore = toItemSnapshot(current);

    const [archived] = await tx
      .update(items)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(items.id, item_id))
      .returning();
    if (!archived) throw new Error("delete-item: update returned no row");

    await tx.insert(activityLog).values({
      listId: current.listId,
      entityType: "item",
      entityId: current.id,
      action: "item_deleted",
      actorId: ctx.userId,
      payloadBefore: snapshotBefore,
      payloadAfter: null,
    });

    return ok({ item: snapshotBefore });
  });
}
