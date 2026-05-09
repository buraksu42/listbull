/**
 * Stale-data cleanup cron (Phase 10-B).
 *
 * Runs daily. Prunes:
 *   - list_invites past expires_at + 7d (keeps a small grace
 *     window for invite-history queries)
 *   - workspace_invites past expires_at + 7d
 *   - activity_log rows older than 90d (single retention window
 *     post-billing-tear-out — was tier-driven before)
 *
 * Conservative: physical DELETE, not soft-archive. Idempotent —
 * re-running mid-day is a no-op for fresh deploys; only rows past
 * the retention window get pulled.
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

  // Activity-log retention: 90d window across the board.
  const activityCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const activityResult = await db.execute<{ count: string }>(
    sql`WITH deleted AS (
      DELETE FROM activity_log
      WHERE created_at < ${activityCutoff.toISOString()}
      RETURNING id
    ) SELECT COUNT(*)::text AS count FROM deleted`,
  );
  const wsActivityResult = { 0: { count: "0" } };

  // Reference-only — silences the unused import warning when one of
  // the SQL paths is the only consumer.
  void lt;
  void activityLog;
  void listInvites;
  void workspaceInvites;

  const listInvitesDeleted = Number(listInviteResult[0]?.count ?? 0);
  const workspaceInvitesDeleted = Number(wsInviteResult[0]?.count ?? 0);
  const activityRowsDeleted = Number(activityResult[0]?.count ?? 0);
  void wsActivityResult;

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
