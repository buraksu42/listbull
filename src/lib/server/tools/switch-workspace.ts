/**
 * Executor: `switch_workspace` — set users.active_workspace_id.
 *
 * Caller must be a member of the target workspace. Resolves by
 * `workspace_id` or `workspace_name` (case-insensitive substring; if
 * ambiguous, returns `ambiguous_workspace`).
 *
 * Phase 4.5: changes `users.active_workspace_id`. The change takes
 * effect on the NEXT bot turn (current turn's `ctx.workspaceId` is
 * already locked). Mini App callers also benefit on next route
 * resolution.
 */
import "server-only";

import { and, eq, ilike, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  switchWorkspaceInputSchema,
  type SwitchWorkspaceOutput,
} from "@/lib/ai/tools";
import { setActiveWorkspace } from "@/lib/db/queries/workspaces";
import { ERR, err, ok } from "./_shared";

import type { WorkspaceRole, WorkspaceTier } from "@/lib/types";
import type { ExecResult } from "./_shared";

export async function executeSwitchWorkspace(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<SwitchWorkspaceOutput>> {
  const parsed = switchWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { workspace_id, workspace_name } = parsed.data;

  // Find candidate workspaces the user is a member of.
  let targetId: string | null = null;
  let candidate: {
    id: string;
    name: string;
    slug: string;
    tier: WorkspaceTier;
    role: WorkspaceRole;
  } | null = null;

  if (workspace_id) {
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        tier: workspaces.tier,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, ctx.userId),
        ),
      )
      .where(eq(workspaces.id, workspace_id))
      .limit(1);
    if (rows.length === 0) {
      return err(ERR.not_found, "No workspace with that id you belong to.");
    }
    const row = rows[0]!;
    candidate = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      tier: row.tier as WorkspaceTier,
      role: row.role as WorkspaceRole,
    };
    targetId = row.id;
  } else if (workspace_name) {
    const candidates = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        tier: workspaces.tier,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, ctx.userId),
        ),
      )
      .where(
        and(
          ilike(workspaces.name, `%${workspace_name}%`),
          sql`${workspaces.archivedAt} is null`,
        ),
      );

    const lower = workspace_name.trim().toLowerCase();
    const exact = candidates.filter((c) => c.name.toLowerCase() === lower);
    const pool = exact.length > 0 ? exact : candidates;
    if (pool.length === 0) {
      return err(
        ERR.not_found,
        `No workspace matching "${workspace_name}" you belong to.`,
      );
    }
    if (pool.length > 1) {
      return err(
        "ambiguous_workspace",
        `Multiple workspaces matched: ${pool.map((c) => c.name).join(", ")}. Specify which one.`,
      );
    }
    const row = pool[0]!;
    candidate = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      tier: row.tier as WorkspaceTier,
      role: row.role as WorkspaceRole,
    };
    targetId = row.id;
  }

  if (!targetId || !candidate) {
    return err(ERR.invalid_input, "Either workspace_id or workspace_name is required.");
  }

  const ok2 = await setActiveWorkspace(ctx.userId, targetId);
  if (!ok2) {
    return err(ERR.forbidden, "You're not a member of that workspace.");
  }

  return ok({
    workspace: {
      id: candidate.id,
      name: candidate.name,
      slug: candidate.slug,
      tier: candidate.tier,
      role: candidate.role,
    },
  });
}
