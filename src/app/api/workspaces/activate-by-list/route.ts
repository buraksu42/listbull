/**
 * `POST /api/workspaces/activate-by-list?listId=<uuid>` — set the
 * caller's active workspace to whatever workspace the named list
 * lives in, IF the caller is a member of that list. Used by the
 * Mini App boot route when a deeplink (`?startapp=list_<uuid>`) lands
 * on a list outside the user's currently-active workspace.
 *
 * Why a dedicated endpoint instead of doing it inside `/lists/[id]`:
 * /lists/[id]/page.tsx is in active refactor by another agent
 * (Kanban view); editing it now would collide. The boot path can
 * just call this before the redirect.
 *
 * Returns:
 *   200 { ok: true, listId, workspaceId, switched } — switched=false
 *     when no change was needed.
 *   404 if the list doesn't exist OR the user has no membership row
 *     for it.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { lists } from "@/lib/db/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getListMember } from "@/lib/db/queries/members";
import {
  resolveActiveWorkspaceId,
  setActiveWorkspace,
} from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Sign in via Telegram" },
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const listId = url.searchParams.get("listId");
  if (!listId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "missing listId" },
      },
      { status: 400 },
    );
  }

  const [list] = await db
    .select({ id: lists.id, workspaceId: lists.workspaceId })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!list) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "list not found" } },
      { status: 404 },
    );
  }

  const member = await getListMember(listId, userId);
  if (!member) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "no access" } },
      { status: 404 },
    );
  }

  const currentActive = await resolveActiveWorkspaceId(userId);
  if (currentActive === list.workspaceId) {
    return NextResponse.json({
      ok: true,
      data: {
        listId: list.id,
        workspaceId: list.workspaceId,
        switched: false,
      },
    });
  }

  const switched = await setActiveWorkspace(userId, list.workspaceId);
  if (!switched) {
    // Edge case: list_member exists but workspace_member doesn't —
    // shouldn't happen given Inv-2, but if it does, surface as 403.
    return NextResponse.json(
      {
        ok: false,
        error: { code: "forbidden", message: "not a workspace member" },
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      listId: list.id,
      workspaceId: list.workspaceId,
      switched: true,
    },
  });
}
