/**
 * Stale-data cleanup cron (Phase 17 chat-only).
 *
 * Two retention buckets:
 *   • `activity_log`: 90 days by default (LISTBULL_ACTIVITY_RETENTION_DAYS).
 *   • `bot_action_contexts`: 24 hours. Force-reply contexts are
 *     short-lived — if a user replies to a day-old prompt the flow
 *     has already lapsed; we treat missing context as "regular
 *     message". Without this delete, the table grows unbounded.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

const DEFAULT_RETENTION_DAYS = 90;

export async function cleanupStale(): Promise<{
  activityRowsDeleted: number;
  botActionContextRowsDeleted: number;
}> {
  const days = Number.parseInt(
    process.env.LISTBULL_ACTIVITY_RETENTION_DAYS ?? "",
    10,
  );
  const retentionDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;

  const activityResult = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM activity_log
       WHERE created_at < NOW() - (${retentionDays} || ' days')::interval
       RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `);

  const contextResult = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM bot_action_contexts
       WHERE created_at < NOW() - interval '24 hours'
       RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `);

  return {
    activityRowsDeleted: activityResult[0]?.count ?? 0,
    botActionContextRowsDeleted: contextResult[0]?.count ?? 0,
  };
}
