/**
 * D2 — snapshot URL generation validators (Phase 4).
 *
 * `POST /api/lists/[id]/snapshot` returns a fresh signed URL + expiry.
 * `GET /api/snapshot/[id]?exp=<ms>&token=<base64url>` returns the
 * `SnapshotPublic` shape (verified per Inv-18).
 */
import { z } from "zod";

import type { SnapshotPublic } from "@/lib/types";

/**
 * Optional `ttlDays` override for the signed URL — server clamps to
 * 1..365. Unset = 30-day default.
 */
export const postSnapshotBodySchema = z
  .object({
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional(),
  })
  .strict();

export type PostSnapshotBody = z.infer<typeof postSnapshotBodySchema>;

/** Response of `POST /api/lists/[id]/snapshot`. */
export type PostSnapshotResponse = {
  url: string;
  /** ISO 8601 — when the signed URL expires. */
  expiresAt: string;
};

/** Response of `GET /api/snapshot/[id]`. */
export type GetSnapshotResponse = {
  snapshot: SnapshotPublic;
};
