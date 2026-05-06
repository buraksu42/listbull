/**
 * `GET /api/workspaces/[id]/activity?limit=50&before=<iso>` — workspace-
 * scoped activity feed for the admin dashboard timeline (Phase 6.5).
 *
 * Workspace-tier owner + admin only. Lower roles see /workspace/admin
 * redirect to /workspace/settings; this endpoint mirrors the same
 * gate.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { getWorkspaceActivityFeed } from "@/lib/db/queries/activity";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Not a member" } },
      { status: 403 },
    );
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Owner or admin only" } },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const before = url.searchParams.get("before");

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (Number.isFinite(parsed)) {
      limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
    }
  }

  const rows = await getWorkspaceActivityFeed(workspaceId, limit, before);
  return NextResponse.json({ ok: true, data: { rows } });
}
