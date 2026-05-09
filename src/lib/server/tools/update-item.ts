/**
 * Executor: `update_item`. Edits text, deadline_at, position, and/or
 * target_list_id (cross-list move within the same workspace).
 *
 * Action mapping per Inv-5:
 *   - target_list_id changed alone → `item_moved`.
 *   - deadline_at is the SOLE changed field → `item_deadline_set` /
 *     `item_deadline_cleared` (Phase 14d).
 *   - any other combination (incl. move + edit) → `item_edited`.
 *
 * Past `deadline_at` values are silently dropped + warning surfaced
 * (matches `create_item`). Phase 14d: when deadline changes,
 * `recomputeOffsetReminders` updates every `before_deadline` reminder
 * for the item in the same transaction.
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
import {
  ERR,
  err,
  isPast,
  ok,
  recomputeOffsetReminders,
  resolveList,
  toItemSnapshot,
} from "./_shared";
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
  const {
    item_id,
    text,
    description,
    deadline_at,
    position,
    target_list_id,
    target_list_name,
    pinned,
    task_recurrence_rule,
  } = parsed.data;

  // Validate task_recurrence_rule if provided so we don't silently
  // store garbage.
  if (typeof task_recurrence_rule === "string") {
    try {
      const { RRule } = await import("rrule");
      RRule.fromString(`RRULE:${task_recurrence_rule}`);
    } catch (e) {
      return err(
        ERR.invalid_input,
        `Invalid task_recurrence_rule: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // Resolve target list (by id or name). The `resolveList` helper handles
  // exact / fuzzy / inbox matching with workspace scoping. We use it
  // outside the transaction since it's read-only; the destination is
  // re-validated inside the transaction below.
  let resolvedTargetListId: string | undefined = undefined;
  if (target_list_id || target_list_name) {
    const resolution = await resolveList(
      ctx,
      { listId: target_list_id, listName: target_list_name },
      // Inbox fallback ON: "Inbox'a taşı" should always work even if
      // the user typed a slightly off name.
      { inboxFallback: true },
    );
    switch (resolution.kind) {
      case "forbidden":
        return err(ERR.forbidden, "You don't have access to that list.");
      case "not_found":
        return err(ERR.not_found, "Target list not found.");
      case "ambiguous": {
        const names = resolution.candidates.map((c) => c.name).join(", ");
        return err(
          ERR.ambiguous_list,
          `List name matched multiple lists: ${names}. Specify which one.`,
        );
      }
    }
    resolvedTargetListId = resolution.listId;
  }

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
    const changes: Array<
      | "text"
      | "description"
      | "deadline_at"
      | "position"
      | "list_id"
      | "pinned"
      | "task_recurrence_rule"
    > = [];
    const warnings: string[] = [];

    if (pinned !== undefined) {
      const isPinned = current.pinnedAt !== null;
      if (pinned && !isPinned) {
        patch.pinnedAt = new Date();
        changes.push("pinned");
      } else if (!pinned && isPinned) {
        patch.pinnedAt = null;
        changes.push("pinned");
      }
    }

    if (task_recurrence_rule !== undefined) {
      const cur = current.taskRecurrenceRule ?? null;
      const next = task_recurrence_rule ?? null;
      if (cur !== next) {
        patch.taskRecurrenceRule = next;
        changes.push("task_recurrence_rule");
      }
    }

    let listIdChanged = false;
    if (
      resolvedTargetListId !== undefined &&
      resolvedTargetListId !== current.listId
    ) {
      // Destination list must exist + sit in the same workspace + caller
      // must have write access on it. resolveList already enforced
      // workspace scope; re-check inside the txn for archive + write.
      const [dest] = await tx
        .select()
        .from(lists)
        .where(
          and(
            eq(lists.id, resolvedTargetListId),
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
        resolvedTargetListId,
        ctx.workspaceId,
      );
      if (!destAllowed) {
        return err(ERR.forbidden, "You don't have access to the target list.");
      }
      patch.listId = resolvedTargetListId;
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

    if (description !== undefined) {
      // Empty/whitespace string normalized to null so the "has
      // description" indicator stays consistent with reality.
      const next =
        description === null
          ? null
          : description.trim().length > 0
            ? description.trim()
            : null;
      if (next !== (current.description ?? null)) {
        patch.description = next;
        changes.push("description");
      }
    }

    let deadlineChanged = false;
    let nextDeadline: Date | null = current.deadlineAt;
    if (deadline_at !== undefined) {
      if (deadline_at === null) {
        if (current.deadlineAt !== null) {
          patch.deadlineAt = null;
          changes.push("deadline_at");
          deadlineChanged = true;
          nextDeadline = null;
        }
      } else {
        if (isPast(deadline_at)) {
          warnings.push("deadline_at_in_past");
        } else {
          const newDate = new Date(deadline_at);
          const oldIso = current.deadlineAt?.toISOString() ?? null;
          if (oldIso !== newDate.toISOString()) {
            patch.deadlineAt = newDate;
            changes.push("deadline_at");
            deadlineChanged = true;
            nextDeadline = newDate;
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

    // Phase 14d: when deadline changed, recompute every
    // before_deadline reminder for this item (clear / re-anchor).
    if (deadlineChanged) {
      await recomputeOffsetReminders(tx, item_id, nextDeadline);
    }

    // Decide which activity action to write.
    const deadlineIsSole =
      deadlineChanged && changes.length === 1 && changes[0] === "deadline_at";
    const moveIsSole =
      listIdChanged && changes.length === 1 && changes[0] === "list_id";
    let action: ActivityAction;
    if (deadlineIsSole) {
      action =
        updated.deadlineAt === null
          ? "item_deadline_cleared"
          : "item_deadline_set";
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
