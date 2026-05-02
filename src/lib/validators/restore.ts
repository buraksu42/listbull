/**
 * F2 — restore endpoint validators (Phase 4).
 *
 * `POST /api/lists/[id]/restore` body. Owner-only at the route layer;
 * the 30-day window is enforced server-side regardless of UI state
 * (Inv-21).
 */
import { z } from "zod";

import type { ItemSnapshot } from "@/lib/types";

export const postRestoreBodySchema = z.object({
  activityLogId: z.string().uuid(),
});

export type PostRestoreBody = z.infer<typeof postRestoreBodySchema>;

/**
 * Response of `POST /api/lists/[id]/restore`. The new (restored) item
 * is returned in `ItemSnapshot` shape so the client can optimistically
 * insert it into the visible list without a re-fetch.
 */
export type PostRestoreResponse = {
  item: ItemSnapshot;
  /** ID of the activity_log row that triggered the restore. */
  restoredFrom: string;
};
