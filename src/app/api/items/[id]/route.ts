/**
 * Mini App per-item API — PATCH and DELETE /api/items/[id].
 *
 * Reuses tool executors so the Mini App and the bot share one path
 * (Inv-1 transactional write + activity_log; Inv-2 membership check).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { executeCompleteItem } from "@/lib/server/tools/complete-item";
import { executeDeleteItem } from "@/lib/server/tools/delete-item";
import { executeSetItemAttributes } from "@/lib/server/tools/set-item-attributes";
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
  const {
    text,
    description,
    isDone,
    position,
    deadlineAt,
    status,
    priority,
    tags,
    pinned,
    taskRecurrenceRule,
    assigneeId,
  } = parsed.data;

  const workspaceId = await resolveActiveWorkspaceId(userId);

  // The Mini App body can carry `isDone` AND text/position/deadlineAt
  // edits in the same request. We dispatch:
  //   - `isDone` change → `executeCompleteItem` (its own activity row).
  //   - `text` / `position` / `deadlineAt` changes → `executeUpdateItem`.
  // Both share the same DB; sequencing keeps each call's transaction
  // atomic (we accept the slightly weaker "two transactions" guarantee
  // for combined edits — the bot path almost never combines them).

  let lastResult:
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } }
    | null = null;

  if (
    text !== undefined ||
    description !== undefined ||
    position !== undefined ||
    deadlineAt !== undefined ||
    pinned !== undefined ||
    taskRecurrenceRule !== undefined ||
    assigneeId !== undefined
  ) {
    const updateResult = await executeUpdateItem(
      {
        item_id: id,
        text,
        position,
        // description may be `null` (clear), undefined (skip), or string.
        ...(description !== undefined ? { description } : {}),
        // deadlineAt may be `null` (clear), undefined (skip), or string.
        ...(deadlineAt !== undefined ? { deadline_at: deadlineAt } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
        ...(taskRecurrenceRule !== undefined
          ? { task_recurrence_rule: taskRecurrenceRule }
          : {}),
        ...(assigneeId !== undefined ? { assignee_id: assigneeId } : {}),
      },
      { userId, workspaceId },
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
      { userId, workspaceId },
    );
    if (!completeResult.ok) {
      return NextResponse.json(completeResult, {
        status: errorCodeToStatus(completeResult.error.code),
      });
    }
    lastResult = completeResult;
  }

  if (status !== undefined || priority !== undefined || tags !== undefined) {
    const attrsResult = await executeSetItemAttributes(
      {
        item_id: id,
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(tags !== undefined ? { tags } : {}),
      },
      { userId, workspaceId },
    );
    if (!attrsResult.ok) {
      return NextResponse.json(attrsResult, {
        status: errorCodeToStatus(attrsResult.error.code),
      });
    }
    lastResult = attrsResult;
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

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const result = await executeDeleteItem(
    { item_id: id },
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
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
