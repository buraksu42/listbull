import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  items,
  listMembers,
  lists,
  workspaceMembers,
} from "@/lib/db/schema";
import { ensurePersonalWorkspace } from "./workspaces";
import type { Item, List, NewList } from "@/lib/types";

/** A list row with active item counts attached — used for the lists overview. */
export type ListWithCounts = List & {
  openCount: number;
  doneCount: number;
};

/**
 * Ensure the user has a Personal Workspace AND an Inbox list inside
 * it. Idempotent on both — only creates what's missing. Phase 1:
 * called from /start command and any first-touch entry point.
 *
 * Phase 4.5 retrofit: the Inbox now lives inside the user's Personal
 * Workspace (one Inbox per workspace, per
 * `lists_workspace_inbox_unique`). `ensurePersonalWorkspace` runs
 * first to guarantee the workspace exists; the Inbox lookup keys off
 * `(workspace_id, is_inbox = true)` rather than `(owner_id, is_inbox =
 * true)` so additional shared workspaces can each have their own
 * Inbox without clashing with the user's personal one.
 */
export async function ensureInbox(userId: string): Promise<List> {
  const workspace = await ensurePersonalWorkspace(userId);

  return db.transaction(async (tx) => {
    const existing = await tx.query.lists.findFirst({
      where: and(
        eq(lists.workspaceId, workspace.id),
        eq(lists.isInbox, true),
      ),
    });
    if (existing) return existing;

    const insertValues: NewList = {
      name: "Inbox",
      emoji: "📥",
      ownerId: userId,
      workspaceId: workspace.id,
      isInbox: true,
    };
    const [created] = await tx.insert(lists).values(insertValues).returning();
    if (!created) {
      throw new Error("ensureInbox: insert returned no row");
    }

    await tx.insert(listMembers).values({
      listId: created.id,
      userId,
      role: "owner",
    });

    return created;
  });
}

/**
 * Lists the user can see in the given WORKSPACE, with item counts
 * (active items broken into open vs done so the UI can show "3 / 7"
 * or "3 görev" depending on preference). Joined via list_members
 * (every owner gets a row at create-time, so this covers owned +
 * shared lists in one query). Inbox first, then by createdAt asc.
 *
 * Phase 4.5: scoped to one workspace. Callers must resolve the
 * active workspace first (via resolveActiveWorkspaceId or the bot's
 * ctx.workspaceId).
 */
export async function listListsForUser(
  userId: string,
  workspaceId: string,
): Promise<ListWithCounts[]> {
  // Phase 16/#28: visibility-aware enumeration. A list is visible to
  // the user when EITHER a list_members row exists (any role) OR the
  // list is public AND the user is a workspace member. We pivot off
  // `lists` (instead of list_members like before) and OR-join both
  // membership paths.
  const rows = await db
    .select({
      list: lists,
      openCount: sql<number>`count(*) filter (where ${items.id} is not null and ${items.isDone} = false and ${items.archivedAt} is null)`,
      doneCount: sql<number>`count(*) filter (where ${items.id} is not null and ${items.isDone} = true and ${items.archivedAt} is null)`,
    })
    .from(lists)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, lists.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .leftJoin(
      listMembers,
      and(
        eq(listMembers.listId, lists.id),
        eq(listMembers.userId, userId),
      ),
    )
    .leftJoin(items, eq(items.listId, lists.id))
    .where(
      and(
        eq(lists.workspaceId, workspaceId),
        isNull(lists.archivedAt),
        or(
          sql`${listMembers.id} IS NOT NULL`,
          sql`${lists.visibility} = 'public'`,
        ),
      ),
    )
    .groupBy(lists.id)
    .orderBy(asc(lists.createdAt));

  return rows
    .map((row) => ({
      ...row.list,
      openCount: Number(row.openCount),
      doneCount: Number(row.doneCount),
    }))
    .sort((a, b) => {
      if (a.isInbox && !b.isInbox) return -1;
      if (!a.isInbox && b.isInbox) return 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}

/**
 * Whether the given user has any visibility on the list (owner or
 * member) AND the list is in the active workspace. Phase 4.5: every
 * Mini App route resolves the active workspace context before
 * calling this — pass it as `workspaceId`.
 */
export async function userCanReadList(
  userId: string,
  listId: string,
  workspaceId: string,
): Promise<boolean> {
  // Path A: legacy list_members row.
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

  // Path B (Phase 16/#28): public list + workspace member.
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

/** Get a list by ID; returns undefined if missing or archived. */
export async function getList(listId: string): Promise<List | undefined> {
  return db.query.lists.findFirst({
    where: and(eq(lists.id, listId), isNull(lists.archivedAt)),
  });
}

/** Items in a list, ordered for display (active first, then position). */
export async function listItemsInList(listId: string): Promise<Item[]> {
  return db
    .select()
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt)))
    .orderBy(
      sql`${items.pinnedAt} DESC NULLS LAST`,
      asc(items.isDone),
      asc(items.position),
      asc(items.createdAt),
    );
}
