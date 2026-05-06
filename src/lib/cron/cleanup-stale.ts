/**
 * Stale-data cleanup cron (Phase 10-B).
 *
 * Runs daily. Prunes:
 *   - list_invites past expires_at + 7d (keeps a small grace
 *     window for invite-history queries)
 *   - workspace_invites past expires_at + 7d
 *   - activity_log rows past their workspace's tier retention
 *     (free=30d, team=90d, workspace=unlimited → never pruned)
 *
 * Conservative: physical DELETE, not soft-archive. The activity log
 * already has 30/90/unlimited retention semantics per tier — operator
 * sees this as expected behavior.
 *
 * Idempotent: re-running mid-day is a no-op for fresh deploys; only
 * rows past their retention window get pulled.
 *
 * Run command:
 *     npx tsx src/lib/cron/cleanup-stale.ts
 */
import { lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  listInvites,
  workspaceInvites,
} from "@/lib/db/schema";

const INVITE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days past expiry

export async function cleanupStale(): Promise<{
  listInvitesDeleted: number;
  workspaceInvitesDeleted: number;
  activityRowsDeleted: number;
}> {
  const inviteCutoff = new Date(Date.now() - INVITE_GRACE_MS);

  // Stale list_invites (past expiry + grace).
  const listInviteResult = await db.execute<{ count: string }>(
    sql`WITH deleted AS (
      DELETE FROM list_invites
      WHERE expires_at < ${inviteCutoff.toISOString()}
      RETURNING id
    ) SELECT COUNT(*)::text AS count FROM deleted`,
  );

  // Stale workspace_invites.
  const wsInviteResult = await db.execute<{ count: string }>(
    sql`WITH deleted AS (
      DELETE FROM workspace_invites
      WHERE expires_at < ${inviteCutoff.toISOString()}
      RETURNING id
    ) SELECT COUNT(*)::text AS count FROM deleted`,
  );

  // Activity-log retention: per-tier window via JOIN to workspaces.
  // Workspace-tier rows (retentionDays=-1) are never pruned. Tier
  // limits frozen in src/lib/types/billing.ts TIER_LIMITS.
  const freeCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const teamCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const activityResult = await db.execute<{ count: string }>(
    sql`WITH deleted AS (
      DELETE FROM activity_log al
      USING lists l, workspaces w
      WHERE
        -- list events: scope by parent workspace tier
        (al.list_id IS NOT NULL AND l.id = al.list_id AND w.id = l.workspace_id
         AND (
           (w.tier = 'free' AND al.created_at < ${freeCutoff.toISOString()})
           OR (w.tier = 'team' AND al.created_at < ${teamCutoff.toISOString()})
         ))
      RETURNING al.id
    ) SELECT COUNT(*)::text AS count FROM deleted`,
  );

  // Workspace-shell events (entity_type='workspace', list_id NULL):
  // tier resolved via entity_id = workspaces.id.
  const wsActivityResult = await db.execute<{ count: string }>(
    sql`WITH deleted AS (
      DELETE FROM activity_log al
      USING workspaces w
      WHERE al.entity_type = 'workspace'
        AND al.list_id IS NULL
        AND w.id = al.entity_id
        AND (
          (w.tier = 'free' AND al.created_at < ${freeCutoff.toISOString()})
          OR (w.tier = 'team' AND al.created_at < ${teamCutoff.toISOString()})
        )
      RETURNING al.id
    ) SELECT COUNT(*)::text AS count FROM deleted`,
  );

  // Reference-only — silences the unused import warning when one of
  // the SQL paths is the only consumer.
  void lt;
  void activityLog;
  void listInvites;
  void workspaceInvites;

  const listInvitesDeleted = Number(listInviteResult[0]?.count ?? 0);
  const workspaceInvitesDeleted = Number(wsInviteResult[0]?.count ?? 0);
  const activityRowsDeleted =
    Number(activityResult[0]?.count ?? 0) +
    Number(wsActivityResult[0]?.count ?? 0);

  console.log(
    "[cleanup-stale] complete",
    JSON.stringify({
      listInvitesDeleted,
      workspaceInvitesDeleted,
      activityRowsDeleted,
    }),
  );

  return {
    listInvitesDeleted,
    workspaceInvitesDeleted,
    activityRowsDeleted,
  };
}

if (require.main === module) {
  cleanupStale()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[cleanup-stale] FAILED:", err);
      process.exit(1);
    });
}
