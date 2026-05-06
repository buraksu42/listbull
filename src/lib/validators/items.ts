/**
 * Mini App items API validators.
 *
 * Same zod schemas validate client-side (react-hook-form) and server-side
 * (route handler). The bot path uses AI-tools' input schemas instead —
 * these are dedicated to the HTTP surface.
 */
import { z } from "zod";

import type { ItemSnapshot } from "@/lib/types";

/**
 * Body of `POST /api/items`. The user supplies `text` and (optionally)
 * a target `listId`. When `listId` is omitted, the executor falls back
 * to the user's Inbox via the same Inv-3 resolution rule the bot uses.
 */
export const createItemBodySchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "text is required")
      .max(2000, "text must be ≤2000 chars"),
    listId: z.string().uuid().optional(),
    listName: z.string().min(1).max(200).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    isCheckable: z.boolean().default(true),
  })
  .refine(
    (v) => !(v.isCheckable === false && v.dueAt !== undefined),
    {
      message: "notes (isCheckable=false) cannot have dueAt",
      path: ["dueAt"],
    },
  );

export type CreateItemBody = z.infer<typeof createItemBodySchema>;

/**
 * Body of `PATCH /api/items/[id]`. All fields optional; at least one
 * must be present. `dueAt: null` clears the reminder; omitting leaves
 * it untouched.
 */
export const updateItemBodySchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    isDone: z.boolean().optional(),
    position: z.number().int().nonnegative().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.isDone !== undefined ||
      v.position !== undefined ||
      v.dueAt !== undefined,
    {
      message: "at least one of text, isDone, position, dueAt must be supplied",
    },
  );

export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;

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
  /** Present when `update_item` ran (text/position/dueAt edits). */
  changes?: Array<"text" | "position" | "due_at">;
  /** Soft warnings — e.g. `due_at_in_past`. */
  warnings?: string[];
};

/**
 * Response shape of `POST /api/items` — same envelope as `update_item`.
 */
export type CreateItemResponse = {
  item: ItemSnapshot;
  warnings?: string[];
};

/**
 * Response shape of `DELETE /api/items/[id]`.
 */
export type DeleteItemResponse = {
  item_id: string;
  /** Pre-archive snapshot for client-side undo affordance. */
  pre_archive_snapshot: ItemSnapshot;
};
