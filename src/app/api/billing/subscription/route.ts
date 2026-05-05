/**
 * `GET /api/billing/subscription?workspaceId=<uuid>` — read-only
 * subscription state for the workspace. Mini App surfaces this for
 * the Plan & billing page + past-due banner.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { getWorkspaceBillingState } from "@/lib/billing/tier-check";
import { TIER_LIMITS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "workspaceId is required" } },
      { status: 400 },
    );
  }

  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Not a member" } },
      { status: 403 },
    );
  }

  const state = await getWorkspaceBillingState(workspaceId);
  return NextResponse.json({
    ok: true,
    data: {
      tier: state.tier,
      status: state.status,
      pastDueLocked: state.pastDueLocked,
      limits: TIER_LIMITS[state.tier],
    },
  });
}
