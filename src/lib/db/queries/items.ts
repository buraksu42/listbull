/**
 * Item-level query helpers used by tool executors and the items API
 * route. Membership/role checks live here too so executors and routes
 * share one canonical path.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { items, listMembers, lists, workspaceMembers } from "@/lib/db/schema";
import type { Item, ListRole, NewItem, WorkspaceRole } from "@/lib/types";

/** Roles allowed to mutate items in a list. Viewer is read-only. */
const WRITE_ROLES: ListRole[] = ["owner", "editor"];

/** Workspace roles that grant write access on PUBLIC lists. */
const WORKSPACE_WRITE_ROLES: WorkspaceRole[] = ["owner", "admin", "editor"];

/**
 * Fetch one item by primary key. Returns undefined for missing rows.
 * Does NOT filter by `archivedAt` — caller decides whether soft-deleted
 * rows are visible (e.g. `delete_item` rejects archived items, the
 * Mini App route hides them).
 */
export async function getItem(id: string): Promise<Item | undefined> {
  return db.query.items.findFirst({ where: eq(items.id, id) });
}

/**
 * Insert one item row, returning the persisted row.
 */
export async function insertItem(values: NewItem): Promise<Item> {
  const [row] = await db.insert(items).values(values).returning();
  if (!row) throw new Error("insertItem: insert returned no row");
  return row;
}

/**
 * Apply a partial patch to an item. Returns the post-update row.
 * Caller is responsible for the membership check + activity_log write
 * (those happen inside the executor's transaction).
 */
export async function updateItem(
  id: string,
  patch: Partial<NewItem>,
): Promise<Item | undefined> {
  const [row] = await db
    .update(items)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();
  return row;
}

/**
 * Soft-delete: set `archived_at = now()`. Returns the post-archive row.
 */
export async function archiveItem(id: string): Promise<Item | undefined> {
  const now = new Date();
  const [row] = await db
    .update(items)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(items.id, id))
    .returning();
  return row;
}

/**
 * Membership predicate: does the user have write access (owner|editor)
 * to the given list AND is the list in the given workspace? Used by
 * every mutation tool executor and Mini App mutation route.
 *
 * Phase 4.5: workspace_id check guards against cross-workspace
 * access — a user with multiple workspaces cannot mutate a list in
 * the inactive workspace via a stale list_id.
 */
export async function userCanWriteList(
  userId: string,
  listId: string,
  workspaceId: string,
): Promise<boolean> {
  // Path A: legacy list_members row with a write-capable role.
  const listMemberRows = await db
    .select({ id: listMembers.id })
    .from(listMembers)
    .innerJoin(lists, eq(lists.id, listMembers.listId))
    .where(
      and(
        eq(listMembers.listId, listId),
        eq(listMembers.userId, userId),
        inArray(listMembers.role, WRITE_ROLES),
        eq(lists.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (listMemberRows.length > 0) return true;

  // Path B (Phase 16/#28): list is public AND caller is a workspace
  // member with a write-capable workspace role.
  const publicRows = await db
    .select({ id: lists.id })
    .from(lists)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, lists.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(lists.id, listId),
        eq(lists.workspaceId, workspaceId),
        sql`${lists.visibility} = 'public'`,
        inArray(workspaceMembers.role, WORKSPACE_WRITE_ROLES),
      ),
    )
    .limit(1);
  return publicRows.length > 0;
}

/**
 * Membership predicate: can the user READ the given list in the
 * active workspace? Two paths:
 *   - list_members row exists (any role), OR
 *   - list.visibility='public' AND user is a workspace member
 *     (any workspace role can read public lists).
 */
export async function userCanReadList(
  userId: string,
  listId: string,
  workspaceId: string,
): Promise<boolean> {
  const listMemberRows = await db
    .select({ id: listMembers.id })
    .from(listMembers)
    .innerJoin(lists, eq(lists.id, listMembers.listId))
    .where(
      and(
        eq(listMembers.listId, listId),
        eq(listMembers.userId, userId),
        eq(lists.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (listMemberRows.length > 0) return true;

  const publicRows = await db
    .select({ id: lists.id })
    .from(lists)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, lists.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(lists.id, listId),
        eq(lists.workspaceId, workspaceId),
        sql`${lists.visibility} = 'public'`,
      ),
    )
    .limit(1);
  return publicRows.length > 0;
}
