/**
 * `POST /api/workspaces/[id]/activate` — set users.active_workspace_id.
 * Verifies membership; mismatched workspace_id returns 403.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { setActiveWorkspace } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id } = await params;
  const ok = await setActiveWorkspace(userId, id);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Not a member of that workspace" } },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, data: { workspaceId: id } });
}
