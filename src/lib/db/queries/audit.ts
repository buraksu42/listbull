/**
 * F2 audit-feed read query (Phase 4).
 *
 * Owner-only — the route handler enforces. The query mirrors
 * `getActivityFeed` shape but adds:
 *   - `filter` discriminator (`all | deletions | edits | permissions`)
 *   - server-computed `canRestore` boolean (Inv-21: action ===
 *     'item_deleted' AND createdAt > now-30d)
 *
 * Note: `getActivityFeed` could be reused for the unfiltered branch,
 * but a single dedicated query keeps the filter clauses + `canRestore`
 * computation co-located.
 */
import { and, desc, eq, lt, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, users } from "@/lib/db/schema";
import type {
  ActivityAction,
  ActivityEntityType,
  AuditEntryWithRestore,
} from "@/lib/types";

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

export type AuditFilter = "all" | "deletions" | "edits" | "permissions";

/** Restore window — Inv-21. Server enforces regardless of UI state. */
const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const FILTER_ACTIONS: Record<Exclude<AuditFilter, "all">, ActivityAction[]> = {
  deletions: ["item_deleted", "list_archived"],
  edits: [
    "item_edited",
    "item_moved",
    "item_completed",
    "item_uncompleted",
    "item_assigned",
    "item_unassigned",
    "item_due_set",
    "item_due_cleared",
    "list_renamed",
    "list_restored",
  ],
  permissions: ["member_added", "member_removed", "member_role_changed"],
};

export async function getAuditFeed(
  listId: string,
  filter: AuditFilter,
  limit: number,
  beforeIso?: string | null,
): Promise<{ rows: AuditEntryWithRestore[]; hasMore: boolean }> {
  const safeLimit = Math.max(
    1,
    Math.min(AUDIT_MAX_LIMIT, Math.trunc(limit) || AUDIT_DEFAULT_LIMIT),
  );

  const conds = [eq(activityLog.listId, listId)];
  if (filter !== "all") {
    const actions = FILTER_ACTIONS[filter];
    conds.push(inArray(activityLog.action, actions));
  }
  if (beforeIso) {
    const beforeDate = new Date(beforeIso);
    if (!Number.isNaN(beforeDate.getTime())) {
      conds.push(lt(activityLog.createdAt, beforeDate));
    }
  }

  // Fetch one extra row to compute hasMore.
  const rows = await db
    .select({
      id: activityLog.id,
      listId: activityLog.listId,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      action: activityLog.action,
      actorId: activityLog.actorId,
      actorFirstName: users.telegramFirstName,
      actorUsername: users.telegramUsername,
      actorPhotoUrl: users.telegramPhotoUrl,
      payloadBefore: activityLog.payloadBefore,
      payloadAfter: activityLog.payloadAfter,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.actorId))
    .where(and(...conds))
    .orderBy(desc(activityLog.createdAt))
    .limit(safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const trimmed = hasMore ? rows.slice(0, safeLimit) : rows;
  const cutoff = Date.now() - RESTORE_WINDOW_MS;

  const mapped: AuditEntryWithRestore[] = trimmed.map((r) => {
    const createdAtMs = r.createdAt.getTime();
    const canRestore =
      r.action === "item_deleted" && createdAtMs > cutoff;
    return {
      id: r.id,
      listId: r.listId ?? listId,
      entityType: r.entityType as ActivityEntityType,
      entityId: r.entityId,
      action: r.action as ActivityAction,
      actorId: r.actorId,
      actorFirstName: r.actorFirstName,
      actorUsername: r.actorUsername,
      actorPhotoUrl: r.actorPhotoUrl,
      payloadBefore: r.payloadBefore,
      payloadAfter: r.payloadAfter,
      createdAt: r.createdAt.toISOString(),
      canRestore,
    };
  });

  return { rows: mapped, hasMore };
}

/**
 * Single-row lookup used by the restore endpoint. Returns the raw
 * activity_log row so the caller can read `payload_before`,
 * `created_at`, `action`, etc.
 */
export async function getActivityLogRow(activityLogId: string): Promise<
  | {
      id: string;
      listId: string | null;
      entityType: string;
      entityId: string;
      action: string;
      actorId: string;
      payloadBefore: unknown;
      payloadAfter: unknown;
      createdAt: Date;
    }
  | undefined
> {
  const [row] = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.id, activityLogId))
    .limit(1);
  return row;
}

