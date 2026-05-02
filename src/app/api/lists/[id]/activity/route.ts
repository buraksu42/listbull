/**
 * `GET /api/lists/[id]/activity?limit=50&before=<iso>` — paginated B1
 * activity feed. Membership-gated (any role); single SQL JOIN to
 * `users` for actor display info (no N+1).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { getActivityFeed } from "@/lib/db/queries/activity";
import { userCanReadList } from "@/lib/db/queries/lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request, { params }: RouteCtx) {
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
  const canRead = await userCanReadList(userId, id);
  if (!canRead) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const before = url.searchParams.get("before");

  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(parsed)));
    }
  }

  const rows = await getActivityFeed(id, limit, before);

  // nextCursor: only set if we returned exactly `limit` rows; the next
  // fetch should pass the createdAt of the last (oldest) row.
  const nextCursor =
    rows.length === limit ? rows[rows.length - 1]?.createdAt ?? null : null;

  return NextResponse.json({
    ok: true,
    data: { rows, nextCursor },
  });
}
