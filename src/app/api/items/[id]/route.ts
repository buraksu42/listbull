/**
 * Mini App per-item API — PATCH and DELETE /api/items/[id].
 *
 * Reuses tool executors so the Mini App and the bot share one path
 * (Inv-1 transactional write + activity_log; Inv-2 membership check).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { executeCompleteItem } from "@/lib/server/tools/complete-item";
import { executeDeleteItem } from "@/lib/server/tools/delete-item";
import { executeUpdateItem } from "@/lib/server/tools/update-item";
import {
  deleteItemParamsSchema,
  updateItemBodySchema,
} from "@/lib/validators/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteCtx) {
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
  const idCheck = deleteItemParamsSchema.safeParse({ id });
  if (!idCheck.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "Invalid item id" },
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = updateItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }
  const { text, isDone, position, dueAt } = parsed.data;

  // The Mini App body can carry `isDone` AND text/position/dueAt edits
  // in the same request. We dispatch:
  //   - `isDone` change → `executeCompleteItem` (its own activity row).
  //   - `text` / `position` / `dueAt` changes → `executeUpdateItem`.
  // Both share the same DB; sequencing keeps each call's transaction
  // atomic (we accept the slightly weaker "two transactions" guarantee
  // for combined edits — the bot path almost never combines them).

  let lastResult:
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } }
    | null = null;

  if (
    text !== undefined ||
    position !== undefined ||
    dueAt !== undefined
  ) {
    const updateResult = await executeUpdateItem(
      {
        item_id: id,
        text,
        position,
        // dueAt may be `null` (clear), undefined (skip), or string.
        ...(dueAt !== undefined ? { due_at: dueAt } : {}),
      },
      { userId },
    );
    if (!updateResult.ok) {
      return NextResponse.json(updateResult, {
        status: errorCodeToStatus(updateResult.error.code),
      });
    }
    lastResult = updateResult;
  }

  if (isDone !== undefined) {
    const completeResult = await executeCompleteItem(
      { item_id: id, is_done: isDone },
      { userId },
    );
    if (!completeResult.ok) {
      return NextResponse.json(completeResult, {
        status: errorCodeToStatus(completeResult.error.code),
      });
    }
    lastResult = completeResult;
  }

  if (lastResult === null) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "no fields supplied",
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(lastResult);
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
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
  const idCheck = deleteItemParamsSchema.safeParse({ id });
  if (!idCheck.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "Invalid item id" },
      },
      { status: 400 },
    );
  }

  const result = await executeDeleteItem({ item_id: id }, { userId });
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
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
