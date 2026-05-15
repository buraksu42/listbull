/**
 * Stale-data cleanup cron (Phase 17 chat-only).
 *
 * Invites are gone with the workspace/list drop; only activity_log
 * retention remains. Default retention: 90 days, configurable via
 * `LISTBULL_ACTIVITY_RETENTION_DAYS` env.
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";

const DEFAULT_RETENTION_DAYS = 90;

export async function cleanupStale(): Promise<{
  activityRowsDeleted: number;
}> {
  const days = Number.parseInt(
    process.env.LISTBULL_ACTIVITY_RETENTION_DAYS ?? "",
    10,
  );
  const retentionDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;

  const result = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM activity_log
       WHERE created_at < NOW() - (${retentionDays} || ' days')::interval
       RETURNING 1
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `);
  const row = result[0];
  return { activityRowsDeleted: row?.count ?? 0 };
}
