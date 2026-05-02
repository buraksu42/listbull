/**
 * `POST /api/lists/[id]/invite` — share-sheet invite-create endpoint.
 *
 * Reuses `executeShareList` so the bot tool path and the Mini App
 * share-sheet path share one write path (Inv-1, Inv-13).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { executeShareList } from "@/lib/server/tools/share-list";
import { postInviteBodySchema } from "@/lib/validators/invites";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = postInviteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  const result = await executeShareList(
    {
      username: parsed.data.username,
      role: parsed.data.role,
      list_id: id,
    },
    { userId },
  );

  if (!result.ok) {
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(result, { status });
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
    case "cannot_share_inbox":
      return 400;
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
