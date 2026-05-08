/**
 * Executor: `add_reminder` (Phase 14d).
 *
 * Append one reminder to an item. Two kinds — exactly one input
 * branch must be supplied (XOR enforced by zod refine; double-check
 * here defensively):
 *
 *   - 'absolute' (remind_at): fires at a fixed UTC moment. May carry
 *     an RRULE for recurrence.
 *   - 'before_deadline' (offset_minutes): fires `offset_minutes`
 *     before `items.deadline_at`. Requires the item to have a
 *     deadline at call time (`deadline_required` else). Recurrence
 *     not allowed.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, itemReminders, items } from "@/lib/db/schema";
import {
  addReminderInputSchema,
  type AddReminderOutput,
} from "@/lib/ai/tools";
import {
  ERR,
  err,
  isPast,
  ok,
  toItemReminderSnapshot,
} from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeAddReminder(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<AddReminderOutput>> {
  const parsed = addReminderInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, remind_at, offset_minutes, recurrence_rule } = parsed.data;

  // Validate RRULE up-front so we never write garbage.
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
    let kind: "absolute" | "before_deadline";
    let remindAt: Date;
    let storedOffset: number | null;
    let storedRrule: string | null;

    if (remind_at !== undefined) {
      kind = "absolute";
      if (isPast(remind_at)) {
        // For absolute reminders WITHOUT an RRULE, dropping silently is
        // the right move (matches old schedule_reminder UX). If RRULE
        // is set, the rule itself may resolve to a future occurrence
        // when the cron parses it — we still accept the past anchor;
        // the dispatcher will skip-and-advance.
        if (!recurrence_rule) {
          warnings.push("remind_at_in_past");
          // Soft-fail: surface warning but no row. The LLM phrases
          // "geçmişte, ileri bir zaman ister misin?".
          return err(
            ERR.invalid_input,
            "remind_at is in the past. Provide a future time.",
          );
        }
      }
      remindAt = new Date(remind_at);
      storedOffset = null;
      storedRrule = recurrence_rule ?? null;
    } else {
      // offset_minutes branch (refined non-undefined).
      if (offset_minutes === undefined) {
        // Defensive — refine should have caught this.
        return err(
          ERR.invalid_input,
          "offset_minutes required when remind_at omitted.",
        );
      }
      if (current.deadlineAt === null) {
        return err(
          "deadline_required",
          "Item has no deadline; set one before adding a before-deadline reminder.",
        );
      }
      kind = "before_deadline";
      remindAt = new Date(
        current.deadlineAt.getTime() - offset_minutes * 60_000,
      );
      storedOffset = offset_minutes;
      storedRrule = null;
    }

    const [inserted] = await tx
      .insert(itemReminders)
      .values({
        itemId: item_id,
        remindAt,
        kind,
        offsetMinutes: storedOffset,
        recurrenceRule: storedRrule,
        sent: false,
      })
      .returning();
    if (!inserted) {
      throw new Error("add-reminder: insert returned no row");
    }

    await tx.insert(activityLog).values({
      listId: current.listId,
      entityType: "item",
      entityId: current.id,
      action: "item_reminder_added",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toItemReminderSnapshot(inserted),
    });

    return ok({
      reminder: toItemReminderSnapshot(inserted),
      kind,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  });
}
