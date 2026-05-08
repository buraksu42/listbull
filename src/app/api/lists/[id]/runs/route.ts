/**
 * Mini App checklist runs API (Phase 16).
 *
 *   POST /api/lists/[id]/runs        — `start_checklist_run` shortcut.
 *   POST /api/lists/[id]/runs?action=complete  — `complete_checklist_run`.
 *   GET  /api/lists/[id]/runs        — list run history (newest first).
 *
 * The single POST with a query-string verb keeps the route count low
 * — the Mini App buttons map cleanly to the two LLM tools without
 * duplicating their permission/idempotency logic here.
 */
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { listRuns } from "@/lib/db/schema";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { userCanReadList } from "@/lib/db/queries/items";
import { toListRunSnapshot } from "@/lib/db/snapshots";
import { executeStartChecklistRun } from "@/lib/server/tools/start-checklist-run";
import { executeCompleteChecklistRun } from "@/lib/server/tools/complete-checklist-run";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteCtx) {
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

  const { id } = await params;
  const check = paramsSchema.safeParse({ id });
  if (!check.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Invalid id" } },
      { status: 400 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const allowed = await userCanReadList(userId, id, workspaceId);
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "forbidden", message: "No access to that list" },
      },
      { status: 403 },
    );
  }

  const rows = await db
    .select()
    .from(listRuns)
    .where(eq(listRuns.listId, id))
    .orderBy(desc(listRuns.startedAt))
    .limit(50);
  return NextResponse.json({
    ok: true,
    data: { runs: rows.map(toListRunSnapshot) },
  });
}

export async function POST(request: Request, { params }: RouteCtx) {
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

  const { id } = await params;
  const check = paramsSchema.safeParse({ id });
  if (!check.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "Invalid id" } },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "start";

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const result =
    action === "complete"
      ? await executeCompleteChecklistRun(
          { list_id: id },
          { userId, workspaceId },
        )
      : await executeStartChecklistRun(
          { list_id: id },
          { userId, workspaceId },
        );

  if (!result.ok) {
    return NextResponse.json(result, {
      status: errorCodeToStatus(result.error.code),
    });
  }
  return NextResponse.json(result);
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "ambiguous_list":
      return 409;
    case "not_a_checklist":
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
