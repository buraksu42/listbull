/**
 * `POST /api/lists/[id]/snapshot` — Phase 4 / D2.
 *
 * Owner-only. Generates an HMAC-signed snapshot URL (Inv-18) for the
 * named list. Body is optional `{ ttlDays?: number }`; when omitted we
 * use the 30-day default.
 *
 * Inbox cannot be snapshotted (matching the bot path).
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { isListOwner } from "@/lib/db/queries/members";
import { lists } from "@/lib/db/schema";
import {
  DEFAULT_SNAPSHOT_TTL_MS,
  generateSnapshotUrl,
} from "@/lib/server/lists/snapshot-token";
import {
  postSnapshotBodySchema,
  type PostSnapshotResponse,
} from "@/lib/validators/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const DAY_MS = 24 * 60 * 60 * 1000;

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

  // Body is optional — accept missing/empty payloads.
  let bodyRaw: unknown = {};
  if (request.headers.get("content-length") !== "0") {
    try {
      const parsedJson: unknown = await request.json();
      bodyRaw = parsedJson ?? {};
    } catch {
      // Empty body OK; malformed body gets a 400 below via zod.
      bodyRaw = {};
    }
  }
  const parsed = postSnapshotBodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const [listRow] = await db
    .select({ isInbox: lists.isInbox, archivedAt: lists.archivedAt })
    .from(lists)
    .where(eq(lists.id, id))
    .limit(1);
  if (!listRow || listRow.archivedAt) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }
  if (listRow.isInbox) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "cannot_snapshot_inbox",
          message: "Inbox lists cannot be snapshotted.",
        },
      },
      { status: 400 },
    );
  }

  const isOwner = await isListOwner(id, userId);
  if (!isOwner) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only the list owner can take a snapshot.",
        },
      },
      { status: 403 },
    );
  }

  const ttlMs = parsed.data.ttlDays
    ? parsed.data.ttlDays * DAY_MS
    : DEFAULT_SNAPSHOT_TTL_MS;
  const { url, expiresAt } = generateSnapshotUrl(id, ttlMs);

  const data: PostSnapshotResponse = { url, expiresAt };
  return NextResponse.json({ ok: true, data });
}
