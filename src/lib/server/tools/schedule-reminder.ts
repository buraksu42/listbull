/**
 * Executor: `schedule_reminder` (Phase 3).
 *
 * Thin semantic wrapper over `update_item` for the `due_at` column.
 * Same idempotency rules as `update_item` (no-op skip activity_log
 * row when value is unchanged), plus:
 *   - Notes (`is_checkable=false`) cannot be scheduled →
 *     `cannot_schedule_note`.
 *   - Past `due_at` values are silently dropped + warning surfaced;
 *     the executor still returns `ok` with the unchanged item snapshot.
 *   - Re-arming: setting `reminder_sent = false` when a non-null
 *     `due_at` is written, so the cron picks up a re-scheduled item
 *     even when it had already fired.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items } from "@/lib/db/schema";
import {
  scheduleReminderInputSchema,
  type ScheduleReminderOutput,
} from "@/lib/ai/tools";
import { ERR, err, isPast, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeScheduleReminder(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<ScheduleReminderOutput>> {
  const parsed = scheduleReminderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, due_at, recurrence_rule } = parsed.data;

  // Validate the RRULE if provided so we don't silently store garbage.
  // `recurrence_rule === null` is the explicit "remove recurrence"
  // signal (handled below); only validate when it's a non-null string.
  if (typeof recurrence_rule === "string") {
    try {
      const { RRule } = await import("rrule");
      RRule.fromString(`RRULE:${recurrence_rule}`);
    } catch (e) {
      return err(
        ERR.invalid_input,
        `Invalid RRULE: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current || current.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }
    if (!current.isCheckable) {
      return err("cannot_schedule_note", "Notes cannot have reminders.");
    }

    const allowed = await userCanWriteList(
      ctx.userId,
      current.listId,
      ctx.workspaceId,
    );
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const warnings: string[] = [];
    let cleared = false;
    const oldDueAtIso = current.dueAt?.toISOString() ?? null;

    // Resolve target due_at value.
    let nextDueAt: Date | null;
    if (due_at === null) {
      nextDueAt = null;
      cleared = current.dueAt !== null;
    } else {
      if (isPast(due_at)) {
        warnings.push("due_at_in_past");
        // Silently drop — return unchanged snapshot with the warning.
        return ok({
          item: toItemSnapshot(current),
          cleared: false,
          warnings,
        });
      }
      nextDueAt = new Date(due_at);
    }

    // Resolve target recurrence_rule:
    //   - undefined  → leave column untouched
    //   - null       → clear (one-shot or cleared reminder)
    //   - string     → store the rule (validated above)
    // When clearing the reminder (`due_at: null`), force-clear the rule
    // too — recurrence with no anchor is meaningless.
    const oldRrule = current.recurrenceRule ?? null;
    let nextRrule: string | null | undefined;
    if (due_at === null) {
      nextRrule = null;
    } else if (recurrence_rule === undefined) {
      nextRrule = undefined; // unchanged
    } else {
      nextRrule = recurrence_rule; // string or null
    }

    // No-op: due_at + rrule both unchanged from current value.
    const newIso = nextDueAt?.toISOString() ?? null;
    const dueAtUnchanged = newIso === oldDueAtIso;
    const rruleUnchanged =
      nextRrule === undefined || (nextRrule ?? null) === oldRrule;
    if (dueAtUnchanged && rruleUnchanged) {
      return ok({
        item: toItemSnapshot(current),
        cleared: false,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    }

    const now = new Date();
    const patch: Partial<typeof items.$inferInsert> = {
      dueAt: nextDueAt,
      // Re-arm the cron pickup whenever due_at changes.
      reminderSent: false,
      updatedAt: now,
    };
    if (nextRrule !== undefined) {
      patch.recurrenceRule = nextRrule;
    }
    const [updated] = await tx
      .update(items)
      .set(patch)
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) {
      throw new Error("schedule-reminder: update returned no row");
    }

    const action = nextDueAt === null ? "item_due_cleared" : "item_due_set";

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
      cleared,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
