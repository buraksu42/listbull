/**
 * Executor: `update_item`. Edits text, due_at, and/or position.
 *
 * Action mapping per Inv-5:
 *   - text or position changed (or any combination including due_at) →
 *     `item_edited`.
 *   - due_at is the SOLE changed field → `item_due_set` /
 *     `item_due_cleared` (helps the Phase-3 reminder feed).
 *
 * Past `due_at` values are silently dropped + warning surfaced (matches
 * `create_item`).
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  updateItemInputSchema,
  type UpdateItemOutput,
} from "@/lib/ai/tools";
import type { ActivityAction } from "@/lib/types";
import { ERR, err, isPast, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeUpdateItem(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<UpdateItemOutput>> {
  const parsed = updateItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, text, due_at, position } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");
    if (current.archivedAt) return err(ERR.not_found, "Item not found.");

    // Membership check on the item's list.
    const allowed = await userCanWriteList(
      ctx.userId,
      current.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    // Build patch + diff.
    const patch: Partial<typeof items.$inferInsert> = {
      updatedAt: new Date(),
    };
    const changes: Array<"text" | "due_at" | "position"> = [];
    const warnings: string[] = [];

    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return err(ERR.invalid_input, "text must not be empty.");
      }
      if (trimmed !== current.text) {
        patch.text = trimmed;
        changes.push("text");
      }
    }

    let dueAtChanged = false;
    if (due_at !== undefined) {
      if (due_at === null) {
        if (current.dueAt !== null) {
          patch.dueAt = null;
          patch.reminderSent = false;
          changes.push("due_at");
          dueAtChanged = true;
        }
      } else {
        if (isPast(due_at)) {
          warnings.push("due_at_in_past");
        } else {
          const newDate = new Date(due_at);
          const oldIso = current.dueAt?.toISOString() ?? null;
          if (oldIso !== newDate.toISOString()) {
            patch.dueAt = newDate;
            patch.reminderSent = false;
            changes.push("due_at");
            dueAtChanged = true;
          }
        }
      }
    }

    if (position !== undefined && position !== current.position) {
      patch.position = position;
      changes.push("position");
    }

    // No-op? Return the current row, no activity_log row written.
    if (changes.length === 0) {
      return ok({
        item: toItemSnapshot(current),
        changes,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    const [updated] = await tx
      .update(items)
      .set(patch)
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) throw new Error("update-item: update returned no row");

    // Decide which activity action to write.
    const dueAtIsSole =
      dueAtChanged && changes.length === 1 && changes[0] === "due_at";
    let action: ActivityAction;
    if (dueAtIsSole) {
      action = updated.dueAt === null ? "item_due_cleared" : "item_due_set";
    } else {
      action = "item_edited";
    }

    await tx.insert(activityLog).values({
      listId: updated.listId,
      entityType: "item",
      entityId: updated.id,
      action,
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      changes,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
