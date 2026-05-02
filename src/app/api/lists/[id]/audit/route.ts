/**
 * `GET /api/lists/[id]/audit?filter=<all|deletions|edits|permissions>&limit=<n>&before=<iso>`
 *
 * Phase 4 / F2. Owner-only. Returns the audit feed for the list with
 * a server-computed `canRestore` boolean per row (Inv-21).
 *
 * Filter chips persisted in the URL via `nuqs` on the client; the route
 * handler reads `?filter=` and maps to action sets in the audit query.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  type AuditFilter,
  getAuditFeed,
} from "@/lib/db/queries/audit";
import { isListOwner } from "@/lib/db/queries/members";
import type { AuditFeedResponse } from "@/lib/validators/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const ALLOWED_FILTERS: AuditFilter[] = [
  "all",
  "deletions",
  "edits",
  "permissions",
];

function parseFilter(raw: string | null): AuditFilter {
  if (raw && (ALLOWED_FILTERS as string[]).includes(raw)) {
    return raw as AuditFilter;
  }
  return "all";
}

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

  // Owner-only — non-owner editors get 403 (don't 404 here, the list
  // is real; just inaccessible at this surface).
  const isOwner = await isListOwner(id, userId);
  if (!isOwner) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only the list owner can view the audit log.",
        },
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const before = url.searchParams.get("before");
  const limitRaw = url.searchParams.get("limit");

  let limit = AUDIT_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(AUDIT_MAX_LIMIT, Math.trunc(parsed)));
    }
  }

  const { rows, hasMore } = await getAuditFeed(id, filter, limit, before);
  const data: AuditFeedResponse = { rows, hasMore };
  return NextResponse.json({ ok: true, data });
}
