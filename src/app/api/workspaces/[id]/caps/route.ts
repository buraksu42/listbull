/**
 * Workspace member spend caps (Phase 8 P8-D).
 *
 *   GET  /api/workspaces/[id]/caps                — list all caps
 *   PUT  /api/workspaces/[id]/caps?userId=<uuid>  — upsert one cap
 *   DELETE /api/workspaces/[id]/caps?userId=<uuid> — clear cap
 *
 * Owner + admin only. Caps in USD micro (cents × 10000); 0 =
 * unlimited. Reads from request body: { dailyCapUsdMicro,
 * monthlyCapUsdMicro }.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import {
  deleteMemberCap,
  listMemberCaps,
  upsertMemberCap,
} from "@/lib/db/queries/llm-usage";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

async function authorize(
  workspaceId: string,
): Promise<{ userId: string } | NextResponse> {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Owner or admin only" } },
      { status: 403 },
    );
  }
  return { userId };
}

export async function GET(_request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;
  const caps = await listMemberCaps(workspaceId);
  return NextResponse.json({ ok: true, data: { caps } });
}

export async function PUT(request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const targetUserId = url.searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "userId query param is required",
        },
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
  const { dailyCapUsdMicro, monthlyCapUsdMicro } = body as {
    dailyCapUsdMicro?: unknown;
    monthlyCapUsdMicro?: unknown;
  };
  if (
    typeof dailyCapUsdMicro !== "number" ||
    typeof monthlyCapUsdMicro !== "number" ||
    dailyCapUsdMicro < 0 ||
    monthlyCapUsdMicro < 0
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message:
            "dailyCapUsdMicro + monthlyCapUsdMicro required as non-negative numbers (0 = unlimited)",
        },
      },
      { status: 400 },
    );
  }

  await upsertMemberCap({
    workspaceId,
    userId: targetUserId,
    dailyCapUsdMicro,
    monthlyCapUsdMicro,
  });
  return NextResponse.json({
    ok: true,
    data: { workspaceId, userId: targetUserId, dailyCapUsdMicro, monthlyCapUsdMicro },
  });
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const targetUserId = url.searchParams.get("userId");
  if (!targetUserId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "userId query param is required" } },
      { status: 400 },
    );
  }

  await deleteMemberCap(workspaceId, targetUserId);
  return NextResponse.json({ ok: true });
}
