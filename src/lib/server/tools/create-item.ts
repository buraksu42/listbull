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
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  createItemInputSchema,
  type CreateItemOutput,
} from "@/lib/ai/tools";
import {
  ERR,
  err,
  isPast,
  ok,
  resolveList,
  toItemReminderSnapshot,
  toItemSnapshot,
} from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeCreateItem(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CreateItemOutput>> {
  const parsed = createItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { text, description, list_id, list_name, deadline_at, is_checkable } =
    parsed.data;

  // List resolution lives outside the transaction — read-only and
  // doesn't need to share the write's snapshot. Inv-3 + Inv-2.
  const resolution = await resolveList(
    ctx,
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

  // Past deadline_at → drop the field, surface a warning. Per the
  // contract, past times never set a deadline.
  let deadlineAt: Date | null = null;
  if (deadline_at !== undefined) {
    if (isPast(deadline_at)) {
      warnings.push("deadline_at_in_past");
    } else {
      deadlineAt = new Date(deadline_at);
    }
  }
  // Notes can't have deadline (already enforced by zod refine, but
  // defense in depth).
  if (!is_checkable) deadlineAt = null;

  return await db.transaction(async (tx) => {
    // Compute next position: max+1 within the list (active items only).
    const [maxRow] = await tx
      .select({ position: items.position })
      .from(items)
      .where(eq(items.listId, targetListId))
      .orderBy(desc(items.position))
      .limit(1);
    const nextPosition = (maxRow?.position ?? -1) + 1;

    // Empty string → null (no implicit description). Trim before
    // storage so leading/trailing whitespace doesn't trigger the
    // "has description" indicator.
    const normalizedDescription =
      description === undefined
        ? null
        : description === null
          ? null
          : description.trim().length > 0
            ? description.trim()
            : null;

    const [created] = await tx
      .insert(items)
      .values({
        listId: targetListId,
        text,
        description: normalizedDescription,
        isCheckable: is_checkable,
        isDone: false,
        deadlineAt,
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

    // Phase 14d: when the user provides a deadline at create time,
    // also create one default absolute reminder anchored at the
    // deadline. Preserves the legacy UX where setting a due date
    // implies a ping. The user can add more reminders via
    // `add_reminder` afterward.
    const reminders = [];
    if (deadlineAt !== null) {
      const [reminder] = await tx
        .insert(itemReminders)
        .values({
          itemId: created.id,
          remindAt: deadlineAt,
          kind: "absolute",
          offsetMinutes: null,
          recurrenceRule: null,
          sent: false,
        })
        .returning();
      if (reminder) {
        reminders.push(toItemReminderSnapshot(reminder));
        await tx.insert(activityLog).values({
          listId: targetListId,
          entityType: "item",
          entityId: created.id,
          action: "item_reminder_added",
          actorId: ctx.userId,
          payloadBefore: null,
          payloadAfter: toItemReminderSnapshot(reminder),
        });
      }
    }

    return ok({
      item: snapshot,
      list: {
        id: targetListId,
        name: resolution.listName,
        emoji: resolution.emoji,
      },
      reminders,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}

