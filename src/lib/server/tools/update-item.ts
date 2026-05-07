/**
 * Executor: `update_item`. Edits text, due_at, position, and/or
 * target_list_id (cross-list move within the same workspace).
 *
 * Action mapping per Inv-5:
 *   - target_list_id changed alone → `item_moved`.
 *   - due_at is the SOLE changed field → `item_due_set` /
 *     `item_due_cleared` (helps the Phase-3 reminder feed).
 *   - any other combination (incl. move + edit) → `item_edited`.
 *
 * Past `due_at` values are silently dropped + warning surfaced (matches
 * `create_item`).
 *
 * Move semantics: write the activity row to the DESTINATION list. The
 * source list's audit feed will not show the row; the destination's
 * will. Restore from the activity_log re-creates the item on the
 * destination list (payload_after.listId).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, lists } from "@/lib/db/schema";
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
  const { item_id, text, due_at, position, target_list_id } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current) return err(ERR.not_found, "Item not found.");
    if (current.archivedAt) return err(ERR.not_found, "Item not found.");

    // Membership check on the item's source list.
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
    const changes: Array<"text" | "due_at" | "position" | "list_id"> = [];
    const warnings: string[] = [];

    let listIdChanged = false;
    if (target_list_id !== undefined && target_list_id !== current.listId) {
      // Destination list must exist + sit in the same workspace + caller
      // must have write access on it.
      const [dest] = await tx
        .select()
        .from(lists)
        .where(
          and(
            eq(lists.id, target_list_id),
            eq(lists.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);
      if (!dest) {
        return err(ERR.not_found, "Target list not found in this workspace.");
      }
      if (dest.archivedAt) {
        return err(ERR.not_found, "Target list is archived.");
      }
      const destAllowed = await userCanWriteList(
        ctx.userId,
        target_list_id,
        ctx.workspaceId,
      );
      if (!destAllowed) {
        return err(ERR.forbidden, "You don't have access to the target list.");
      }
      patch.listId = target_list_id;
      changes.push("list_id");
      listIdChanged = true;
    }

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
    const moveIsSole =
      listIdChanged && changes.length === 1 && changes[0] === "list_id";
    let action: ActivityAction;
    if (dueAtIsSole) {
      action = updated.dueAt === null ? "item_due_cleared" : "item_due_set";
    } else if (moveIsSole) {
      action = "item_moved";
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
