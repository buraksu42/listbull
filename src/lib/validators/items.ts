/**
 * Mini App items API validators.
 *
 * Same zod schemas validate client-side (react-hook-form) and server-side
 * (route handler). The bot path uses AI-tools' input schemas instead —
 * these are dedicated to the HTTP surface.
 */
import { z } from "zod";

import type { ItemReminderSnapshot, ItemSnapshot } from "@/lib/types";

/**
 * Body of `POST /api/items`. The user supplies `text` and (optionally)
 * a target `listId`. When `listId` is omitted, the executor falls back
 * to the user's Inbox via the same Inv-3 resolution rule the bot uses.
 *
 * Phase 14d: `dueAt` → `deadlineAt` rename. Reminders are managed
 * through dedicated endpoints (`POST /api/items/[id]/reminders`).
 */
export const createItemBodySchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "text is required")
      .max(2000, "text must be ≤2000 chars"),
    /** Phase 14a: optional long-form body. Empty string treated as null. */
    description: z.string().max(5000).nullable().optional(),
    listId: z.string().uuid().optional(),
    listName: z.string().min(1).max(200).optional(),
    deadlineAt: z.string().datetime({ offset: true }).optional(),
    isCheckable: z.boolean().default(true),
  })
  .refine(
    (v) => !(v.isCheckable === false && v.deadlineAt !== undefined),
    {
      message: "notes (isCheckable=false) cannot have deadlineAt",
      path: ["deadlineAt"],
    },
  );

export type CreateItemBody = z.infer<typeof createItemBodySchema>;

/**
 * Body of `PATCH /api/items/[id]`. All fields optional; at least one
 * must be present. `deadlineAt: null` clears the deadline (and drops
 * before-deadline reminders cascade); omitting leaves it untouched.
 * Reminders themselves are mutated via the `/reminders` sub-routes.
 */
export const updateItemBodySchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    /** Phase 14a: nullable to allow explicit clear; empty string normalized to null. */
    description: z.string().max(5000).nullable().optional(),
    isDone: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
    deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    pinned: z.boolean().optional(),
    taskRecurrenceRule: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.description !== undefined ||
      v.isDone !== undefined ||
      v.position !== undefined ||
      v.deadlineAt !== undefined ||
      v.status !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined ||
      v.pinned !== undefined ||
      v.taskRecurrenceRule !== undefined,
    {
      message:
        "at least one of text, description, isDone, position, deadlineAt, status, priority, tags, pinned, taskRecurrenceRule must be supplied",
    },
  );

export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;

/**
 * Body of `POST /api/items/[id]/reminders` (Phase 14d). XOR between
 * `remindAt` (absolute) and `offsetMinutes` (before deadline). RRULE
 * is only allowed for absolute kind.
 */
export const addReminderBodySchema = z
  .object({
    remindAt: z.string().datetime({ offset: true }).optional(),
    offsetMinutes: z.number().int().min(0).max(525_600).optional(),
    recurrenceRule: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (v) => (v.remindAt !== undefined) !== (v.offsetMinutes !== undefined),
    {
      message: "Provide exactly one of remindAt or offsetMinutes.",
      path: ["remindAt"],
    },
  )
  .refine(
    (v) => !(v.offsetMinutes !== undefined && v.recurrenceRule != null),
    {
      message: "recurrenceRule is only allowed with absolute reminders.",
      path: ["recurrenceRule"],
    },
  );

export type AddReminderBody = z.infer<typeof addReminderBodySchema>;

export const reminderParamsSchema = z.object({
  id: z.string().uuid(),
  reminderId: z.string().uuid(),
});

/**
 * Path params for `DELETE /api/items/[id]`. Mostly here for parity —
 * the route handler reads `params.id` directly but a schema makes
 * future-extension easier.
 */
export const deleteItemParamsSchema = z.object({
  id: z.string().uuid(),
});

export type DeleteItemParams = z.infer<typeof deleteItemParamsSchema>;

/**
 * Response shape of `PATCH /api/items/[id]` (the `data` field after the
 * `{ ok, data }` envelope unwrap). Matches the executor's output —
 * `update_item` returns `{ item, changes, warnings? }` and
 * `complete_item` returns `{ item, was_done }`. The route handler
 * forwards whichever ran; clients should narrow on field presence.
 */
export type PatchItemResponse = {
  item: ItemSnapshot;
  /** Present when `complete_item` ran (toggled isDone). */
  was_done?: boolean;
  /** Present when `update_item` ran (text/position/deadlineAt edits). */
  changes?: Array<
    "text" | "description" | "position" | "deadline_at" | "list_id" | "pinned"
  >;
  /** Soft warnings — e.g. `deadline_at_in_past`. */
  warnings?: string[];
};

/**
 * Response shape of `POST /api/items` — same envelope as `update_item`.
 * Phase 14d: includes the reminders auto-created when a deadline was
 * supplied (default: 1 absolute reminder anchored at the deadline).
 */
export type CreateItemResponse = {
  item: ItemSnapshot;
  reminders?: ItemReminderSnapshot[];
  warnings?: string[];
};

/**
 * Response shape of the `/reminders` add / remove endpoints.
 */
export type AddReminderResponse = {
  reminder: ItemReminderSnapshot;
  kind: "absolute" | "before_deadline";
  warnings?: string[];
};

export type RemoveReminderResponse = {
  reminder_id: string;
  item_id: string;
};

/**
 * Response shape of `DELETE /api/items/[id]`.
 */
export type DeleteItemResponse = {
  item_id: string;
  /** Pre-archive snapshot for client-side undo affordance. */
  pre_archive_snapshot: ItemSnapshot;
};
