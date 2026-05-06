/**
 * `GET /api/workspaces/[id]/recent-deletes` — recent item_deleted
 * activity entries scoped to the workspace, within the 30d restore
 * window. Powers the bulk-restore UI on the workspace admin
 * dashboard.
 *
 * Workspace owner only (mirrors bulk-restore endpoint gate). Returns
 * { id, listId, listName, itemText, deletedBy, deletedAt }
 * per row, ordered newest-first.
 */
import { NextResponse } from "next/server";

import { and, desc, eq, gte } from "drizzle-orm";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { activityLog, lists, users } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 100;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Workspace owner only" } },
      { status: 403 },
    );
  }

  const cutoff = new Date(Date.now() - WINDOW_MS);
  const rows = await db
    .select({
      id: activityLog.id,
      listId: activityLog.listId,
      listName: lists.name,
      payloadBefore: activityLog.payloadBefore,
      actorId: activityLog.actorId,
      actorFirstName: users.telegramFirstName,
      actorUsername: users.telegramUsername,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .innerJoin(lists, eq(lists.id, activityLog.listId))
    .innerJoin(users, eq(users.id, activityLog.actorId))
    .where(
      and(
        eq(lists.workspaceId, workspaceId),
        eq(activityLog.action, "item_deleted"),
        gte(activityLog.createdAt, cutoff),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(PAGE_LIMIT);

  // Extract item text from payloadBefore (ItemSnapshot shape). When
  // malformed, surface "(unknown item)" — restore endpoint still
  // rejects malformed payloads.
  const result = rows.map((r) => {
    let itemText = "(unknown item)";
    const pb = r.payloadBefore;
    if (
      pb &&
      typeof pb === "object" &&
      !Array.isArray(pb) &&
      "text" in pb &&
      typeof (pb as { text?: unknown }).text === "string"
    ) {
      itemText = (pb as { text: string }).text;
    }
    return {
      id: r.id,
      listId: r.listId ?? "",
      listName: r.listName,
      itemText,
      actorFirstName: r.actorFirstName,
      actorUsername: r.actorUsername,
      deletedAt: r.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ ok: true, data: { deletes: result } });
}
