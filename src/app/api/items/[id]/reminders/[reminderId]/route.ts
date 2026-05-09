/**
 * Mini App reminder API — DELETE /api/items/[id]/reminders/[reminderId]
 * (Phase 14d). Reuses `executeRemoveReminder` for ACL + activity_log.
 *
 * The path includes both ids for symmetry, but the executor scopes
 * permission via the parent item's list. The route ignores the `id`
 * (item) component beyond initial schema validation.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { executeRemoveReminder } from "@/lib/server/tools/remove-reminder";
import { reminderParamsSchema } from "@/lib/validators/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = {
  params: Promise<{ id: string; reminderId: string }>;
};

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

  const { id, reminderId } = await params;
  const check = reminderParamsSchema.safeParse({ id, reminderId });
  if (!check.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "Invalid id" },
      },
      { status: 400 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const result = await executeRemoveReminder(
    { reminder_id: reminderId },
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
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
