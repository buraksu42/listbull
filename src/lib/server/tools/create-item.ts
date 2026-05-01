/**
 * Executor: `create_item`.
 *
 * Inserts one row into `items` plus one `activity_log` row in a single
 * transaction (Inv-1). List resolution per Inv-3; membership check
 * implicit in `resolveList` (Inv-2).
 */
import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  createItemInputSchema,
  type CreateItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, isPast, ok, resolveList, toItemSnapshot } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCreateItem(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<CreateItemOutput>> {
  const parsed = createItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { text, list_id, list_name, due_at, is_checkable } = parsed.data;

  // List resolution lives outside the transaction — read-only and
  // doesn't need to share the write's snapshot. Inv-3 + Inv-2.
  const resolution = await resolveList(
    ctx.userId,
    { listId: list_id, listName: list_name },
    { inboxFallback: true },
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

  const targetListId = resolution.listId;
  const warnings: string[] = [];

  // Past due_at → drop the field, surface a warning. Per the contract,
  // past times never set a reminder.
  let dueAt: Date | null = null;
  if (due_at !== undefined) {
    if (isPast(due_at)) {
      warnings.push("due_at_in_past");
    } else {
      dueAt = new Date(due_at);
    }
  }
  // Notes can't have due_at (already enforced by zod refine, but defense in depth).
  if (!is_checkable) dueAt = null;

  return await db.transaction(async (tx) => {
    // Compute next position: max+1 within the list (active items only).
    const [maxRow] = await tx
      .select({ position: items.position })
      .from(items)
      .where(eq(items.listId, targetListId))
      .orderBy(desc(items.position))
      .limit(1);
    const nextPosition = (maxRow?.position ?? -1) + 1;

    const [created] = await tx
      .insert(items)
      .values({
        listId: targetListId,
        text,
        isCheckable: is_checkable,
        isDone: false,
        dueAt,
        position: nextPosition,
        createdBy: ctx.userId,
      })
      .returning();
    if (!created) throw new Error("create-item: insert returned no row");

    const snapshot = toItemSnapshot(created);

    await tx.insert(activityLog).values({
      listId: targetListId,
      entityType: "item",
      entityId: created.id,
      action: "item_created",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: snapshot,
    });

    return ok({
      item: snapshot,
      list: {
        id: targetListId,
        name: resolution.listName,
        emoji: resolution.emoji,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

