/**
 * Mini App reminder API — POST /api/items/[id]/reminders (Phase 14d).
 *
 * Reuses `executeAddReminder` so the bot tool path and the Mini App
 * share one transactional implementation (Inv-1 + activity_log).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { executeAddReminder } from "@/lib/server/tools/add-reminder";
import {
  addReminderBodySchema,
  deleteItemParamsSchema,
} from "@/lib/validators/items";

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

  const parsed = addReminderBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const { remindAt, offsetMinutes, recurrenceRule } = parsed.data;
  const result = await executeAddReminder(
    {
      item_id: id,
      ...(remindAt !== undefined ? { remind_at: remindAt } : {}),
      ...(offsetMinutes !== undefined ? { offset_minutes: offsetMinutes } : {}),
      ...(recurrenceRule !== undefined
        ? { recurrence_rule: recurrenceRule }
        : {}),
    },
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
    case "deadline_required":
      return 409;
    case "invalid_input":
    case "bad_input":
    case "cannot_schedule_note":
      return 400;
    default:
      return 500;
  }
}
