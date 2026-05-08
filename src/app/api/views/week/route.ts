/**
 * Phase 15: GET /api/views/week.
 *
 * Returns items the caller can see whose `deadline_at` falls in
 * `[from, to)`, sorted ascending. ISO date strings are accepted
 * (YYYY-MM-DD); they're interpreted as UTC midnight bounds. The
 * Mini App hands the user-tz week boundary off to this endpoint.
 *
 * Workspace scope: the active workspace by default. An explicit
 * `?workspaceId=` overrides it (the user must still be a member).
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { listItemsByDeadlineRange } from "@/lib/db/queries/views";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  // ISO datetime preferred; bare YYYY-MM-DD acceptable.
  from: z.string().min(8).max(40),
  to: z.string().min(8).max(40),
  workspaceId: z.string().uuid().optional(),
});

const MAX_RANGE_DAYS = 35;

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const fromDate = new Date(parsed.data.from);
  const toDate = new Date(parsed.data.to);
  if (
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    toDate.getTime() <= fromDate.getTime()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "Invalid from/to range" },
      },
      { status: 400 },
    );
  }
  const spanDays =
    (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: `Range too large (max ${MAX_RANGE_DAYS} days)`,
        },
      },
      { status: 400 },
    );
  }

  const workspaceId =
    parsed.data.workspaceId ?? (await resolveActiveWorkspaceId(userId));

  const rows = await listItemsByDeadlineRange({
    userId,
    workspaceId,
    from: fromDate,
    to: toDate,
  });

  return NextResponse.json({
    ok: true,
    data: {
      items: rows.map((r) => ({
        id: r.id,
        listId: r.listId,
        text: r.text,
        deadlineAt: r.deadlineAt ? r.deadlineAt.toISOString() : null,
        priority: r.priority,
        status: r.status,
        isDone: r.isDone,
        list: r.list,
      })),
    },
  });
}
