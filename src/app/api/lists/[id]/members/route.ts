/**
 * `GET /api/lists/[id]/members` — list members for the share-sheet UI.
 * Membership-gated (any role can read).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { userCanReadList } from "@/lib/db/queries/lists";
import { listMembersForList } from "@/lib/db/queries/members";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import type { MembersListResponse } from "@/lib/validators/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const workspaceId = await resolveActiveWorkspaceId(userId);
  const canRead = await userCanReadList(userId, id, workspaceId);
  if (!canRead) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const members = await listMembersForList(id);
  const data: MembersListResponse = { members };
  return NextResponse.json({ ok: true, data });
}
