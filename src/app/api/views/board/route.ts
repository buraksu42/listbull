/**
 * GET /api/views/board — workspace-wide Kanban data source.
 *
 * Aggregates open / in-progress / blocked / done items across every
 * list the caller is a member of inside the active workspace (or an
 * explicit `?workspaceId=` override the caller is also a member of).
 * The 30-day done-window is applied server-side; the client opts out
 * via `?includeAllDone=1`.
 *
 * Wire shape mirrors the per-list `/api/lists/[id]/items` route's
 * `Item[]` so the same `KanbanBoard` component can render either
 * surface — but each row also carries a `list: {id, name, emoji}`
 * pointer for the workspace-board's per-card list badge.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { listItemsForWorkspaceBoard } from "@/lib/db/queries/views";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeAllDone: z
    .union([z.literal("1"), z.literal("true")])
    .optional(),
});

export async function GET(request: Request) {
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
  const parsed = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    includeAllDone: url.searchParams.get("includeAllDone") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const workspaceId =
    parsed.data.workspaceId ?? (await resolveActiveWorkspaceId(userId));

  const items = await listItemsForWorkspaceBoard({
    userId,
    workspaceId,
    includeAllDone: parsed.data.includeAllDone !== undefined,
  });

  return NextResponse.json({ ok: true, items });
}
