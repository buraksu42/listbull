/**
 * Activity feed typed response shapes (Phase 4 · P2-2).
 *
 * The Frontend's activity-feed view imports `ActivityFeedResponse` so the
 * route handler shape is pinned at one place.
 *
 * Phase 4 also introduces an audit-feed view (`AuditFeedResponse`) for the
 * F2 owner-only audit page. It extends each row with a server-computed
 * `canRestore` boolean (Inv-21).
 */
import type { ActivityFeedRow, AuditEntryWithRestore } from "@/lib/types";

/**
 * Response shape of `GET /api/lists/[id]/activity`. `nextCursor` is the
 * `createdAt` ISO string of the oldest row in the page; the client passes
 * it back as `?before=` for the next page. `null` means no more rows.
 */
export type ActivityFeedResponse = {
  rows: ActivityFeedRow[];
  nextCursor: string | null;
};

/**
 * Filter modes for the F2 audit feed. Mirrors the UI filter chips.
 */
export type AuditFilter = "all" | "deletions" | "edits" | "permissions";

/**
 * Response shape of `GET /api/lists/[id]/audit?filter=...`. Owner-only.
 * `hasMore` is `true` when the page is full (more rows possibly behind
 * the cursor); use the last row's `createdAt` as the next `?before=`.
 */
export type AuditFeedResponse = {
  rows: AuditEntryWithRestore[];
  hasMore: boolean;
};
