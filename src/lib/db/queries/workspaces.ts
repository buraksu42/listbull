/**
 * Workspace query helpers (Phase 4.5).
 *
 * Workspace membership is the access-control axis going forward:
 * `lists.workspace_id` joins via `workspace_members` to gate visibility
 * + mutation, on top of the per-list `list_members` row. The two
 * memberships are synced — every member of a list is also a member of
 * its parent workspace (Inv: list visibility = workspace membership ∩
 * list_members).
 *
 * Phase 4.5 ships the read helpers; the workspace CRUD layer
 * (rename, delete, transfer ownership, member invitations) lives in
 * `src/lib/server/workspace/` and is wired by the 6 new LLM tools.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type {
  Workspace,
  WorkspaceListItem,
  WorkspaceRole,
} from "@/lib/types";

/**
 * Build a URL-safe slug from a workspace name. Lowercase, kebab-case,
 * non-alphanumeric collapsed to single hyphens, trimmed. Personal
 * Workspaces get a deterministic slug (`<userId>-personal`) bypassing
 * this helper.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Ensure the user has a Personal Workspace. Idempotent — only creates
 * one if missing. Always inserts the owner as a `workspace_members`
 * row in the same transaction (Inv-2 analog for workspaces).
 *
 * Called by `ensureInbox` (which in turn is called from /start) and
 * directly by the Phase 4.5 migration script for backfill of existing
 * users.
 */
export async function ensurePersonalWorkspace(
  userId: string,
): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const existing = await tx.query.workspaces.findFirst({
      where: and(
        eq(workspaces.ownerId, userId),
        eq(workspaces.isPersonal, true),
      ),
    });
    if (existing) return existing;

    const [created] = await tx
      .insert(workspaces)
      .values({
        name: "Personal",
        slug: `${userId}-personal`,
        isPersonal: true,
        ownerId: userId,
      })
      .returning();
    if (!created) {
      throw new Error("ensurePersonalWorkspace: insert returned no row");
    }

    await tx.insert(workspaceMembers).values({
      workspaceId: created.id,
      userId,
      role: "owner" satisfies WorkspaceRole,
    });

    return created;
  });
}

/**
 * Resolve the user's active workspace id with fallback chain:
 *   1. `users.active_workspace_id` if set AND user is still a member
 *   2. user's Personal Workspace (auto-creates if somehow missing)
 *
 * Used by the bot dispatcher to inject `ctx.workspaceId` into every
 * tool call. Mini App routes use a different path (cookie + query
 * param) per the workspace-context middleware.
 */
export async function resolveActiveWorkspaceId(
  userId: string,
): Promise<string> {
  const [user] = await db.execute<{ active_workspace_id: string | null }>(
    sql`SELECT active_workspace_id FROM users WHERE id = ${userId}`,
  );

  if (user?.active_workspace_id) {
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, user.active_workspace_id),
        eq(workspaceMembers.userId, userId),
      ),
    });
    if (member) return user.active_workspace_id;
  }

  // Fallback: Personal Workspace (auto-create if missing — defensive,
  // should never trigger post-migration).
  const personal = await ensurePersonalWorkspace(userId);

  if (!user?.active_workspace_id) {
    await db.execute(
      sql`UPDATE users SET active_workspace_id = ${personal.id} WHERE id = ${userId}`,
    );
  }

  return personal.id;
}

/**
 * Verify the user is a member of the given workspace. Used by the
 * workspace-context middleware to gate access (Inv: cannot operate
 * on a workspace you don't belong to).
 */
export async function getWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<{ role: WorkspaceRole } | null> {
  const row = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { role: true },
  });
  return row ? { role: row.role as WorkspaceRole } : null;
}

/**
 * Enumerate every workspace the user belongs to, with member + list
 * counts denormalized for the switcher UI + `list_workspaces` tool
 * output. `isActive` is computed against `users.active_workspace_id`.
 */
export async function listWorkspacesForUser(
  userId: string,
): Promise<WorkspaceListItem[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    is_personal: boolean;
    role: string;
    member_count: string;
    list_count: string;
    is_active: boolean;
  }>(sql`
    SELECT
      w.id,
      w.name,
      w.slug,
      w.is_personal,
      wm.role,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id)::text AS member_count,
      (SELECT COUNT(*) FROM ${lists} WHERE workspace_id = w.id AND archived_at IS NULL)::text AS list_count,
      (u.active_workspace_id = w.id) AS is_active
    FROM workspaces w
    INNER JOIN workspace_members wm
      ON wm.workspace_id = w.id AND wm.user_id = ${userId}
    INNER JOIN users u ON u.id = ${userId}
    WHERE w.archived_at IS NULL
    ORDER BY w.is_personal DESC, w.created_at ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    isPersonal: r.is_personal,
    role: r.role as WorkspaceRole,
    memberCount: Number(r.member_count),
    listCount: Number(r.list_count),
    isActive: r.is_active,
  }));
}

/**
 * Set the user's active workspace. Verifies membership before
 * persisting. Returns false (caller should surface forbidden) if the
 * user is not a member of the target workspace.
 */
export async function setActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const member = await getWorkspaceMembership(userId, workspaceId);
  if (!member) return false;

  await db.execute(
    sql`UPDATE users SET active_workspace_id = ${workspaceId} WHERE id = ${userId}`,
  );
  return true;
}

/**
 * Phase 5.5: enumerate workspace members with joined user info.
 * Powers the workspace settings members list + Phase 6+ admin
 * surfaces.
 */
export type WorkspaceMemberWithUser = {
  memberId: string;
  userId: string;
  role: WorkspaceRole;
  acceptedAt: string;
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberWithUser[]> {
  const rows = await db
    .select({
      memberId: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      acceptedAt: workspaceMembers.acceptedAt,
      telegramFirstName: users.telegramFirstName,
      telegramUsername: users.telegramUsername,
      telegramPhotoUrl: users.telegramPhotoUrl,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.acceptedAt));

  return rows.map((r) => ({
    memberId: r.memberId,
    userId: r.userId,
    role: r.role as WorkspaceRole,
    acceptedAt: r.acceptedAt.toISOString(),
    user: {
      telegramFirstName: r.telegramFirstName,
      telegramUsername: r.telegramUsername,
      telegramPhotoUrl: r.telegramPhotoUrl,
    },
  }));
}

/**
 * Phase 5.5 (G6): read the workspace's encrypted org-level
 * OpenRouter key (if Workspace tier admin set one). Returns the
 * raw encrypted blob — caller decrypts via the same helper as
 * BYOK keys. Null when:
 *   - workspace tier is not 'workspace' (org-key gate)
 *   - admin hasn't set a key
 *   - workspace doesn't exist
 *
 * The org-key is workspace-wide: any member of the workspace can
 * use it for their LLM calls when they don't have personal BYOK.
 * Visibility-only via this helper; rotation/replace lives at the
 * settings PATCH endpoint.
 */
export async function getWorkspaceOrgKeyEncrypted(
  workspaceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      keyEnc: workspaces.openrouterApiKeyEncrypted,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.keyEnc ?? null;
}

/**
 * Workspace-scoped LLM model. Returns the column default
 * (`google/gemini-2.5-flash`) when the workspace doesn't exist —
 * caller will hit a noKey path before model selection matters
 * anyway. Used by handle-message.ts in place of the (now stale)
 * per-user `users.llm_model`.
 */
export async function getWorkspaceLlmModel(
  workspaceId: string,
): Promise<string> {
  const [row] = await db
    .select({ llmModel: workspaces.llmModel })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.llmModel ?? "google/gemini-2.5-flash";
}

/**
 * Operator-mode gate for the env-key fallback. Returns the workspace
 * owner's Telegram user id (numeric) — the bot key resolution chain
 * checks this against `env.OPERATOR_TELEGRAM_ID` to decide whether
 * the operator's env key should fund this workspace's calls. Any
 * other workspace must BYOK or set a workspace org-key.
 */
export async function getWorkspaceOwnerTelegramId(
  workspaceId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ telegramId: users.telegramId })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.ownerId))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.telegramId ?? null;
}

/**
 * Returns workspaces the user is a member of that ALSO have an
 * org-key set — used by the noKey copy to suggest switching when
 * the active workspace can't fund a bot turn but another can.
 */
export async function listUserWorkspacesWithKey(
  userId: string,
  excludeWorkspaceId?: string,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        sql`${workspaces.openrouterApiKeyEncrypted} IS NOT NULL`,
        sql`${workspaces.archivedAt} IS NULL`,
      ),
    );
  return rows.filter((r) => r.id !== excludeWorkspaceId);
}

// Order export, no-op consumer for asc — keeps the import live so
// drizzle-kit's tree-shaking doesn't accidentally drop the sort dep.
void asc;
