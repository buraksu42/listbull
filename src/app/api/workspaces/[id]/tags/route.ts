/**
 * `GET /api/workspaces/[id]/tags` — distinct tags currently in use
 * across non-archived items in the workspace. Powers the tag-chip
 * autocomplete UI (Phase 5+) and surfaces the workspace's
 * vocabulary cap (20) for the current-usage indicator.
 *
 * Membership-gated (any role can read). Cap exposed inline so the
 * UI can render "12 / 20 tags used" without a second round-trip.
 */
import { NextResponse } from "next/server";

import { sql } from "drizzle-orm";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_TAG_CAP = 20;

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

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Not a member" } },
      { status: 403 },
    );
  }

  // DISTINCT unnest of items.tags across the workspace's non-archived
  // items. Parameterized — workspaceId goes through Drizzle's bind layer.
  const rows = await db.execute<{ tag: string; usage: string }>(
    sql`SELECT tag, COUNT(*)::text AS usage
        FROM (
          SELECT unnest(i.tags) AS tag
          FROM items i
          INNER JOIN lists l ON l.id = i.list_id
          WHERE l.workspace_id = ${workspaceId}
            AND i.archived_at IS NULL
        ) t
        GROUP BY tag
        ORDER BY COUNT(*) DESC, tag ASC`,
  );

  const tags = rows.map((r) => ({ tag: r.tag, usage: Number(r.usage) }));

  return NextResponse.json({
    ok: true,
    data: {
      tags,
      cap: WORKSPACE_TAG_CAP,
      used: tags.length,
    },
  });
}
