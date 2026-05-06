/**
 * `POST /api/lists/[id]/restore` — Phase 4 / F2.
 *
 * Body: `{ activityLogId: string }`. Owner-only. Server re-validates
 * the 30-day window (Inv-21) regardless of UI state.
 *
 * The transactional restore lives in `src/lib/server/restore.ts`.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { restoreFromActivityLog } from "@/lib/server/restore";
import {
  postRestoreBodySchema,
  type PostRestoreResponse,
} from "@/lib/validators/restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

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

  let bodyRaw: unknown;
  try {
    bodyRaw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = postRestoreBodySchema.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await restoreFromActivityLog({
    listId: id,
    activityLogId: parsed.data.activityLogId,
    callerId: userId,
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.code);
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.code, message: result.message },
      },
      { status },
    );
  }

  const data: PostRestoreResponse = {
    item: result.item,
    restoredFrom: parsed.data.activityLogId,
  };
  return NextResponse.json({ ok: true, data });
}

function errorCodeToStatus(code: string): number {
  switch (code) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "not_restorable":
    case "restore_window_expired":
    case "restore_payload_invalid":
      return 400;
    default:
      return 500;
  }
}
