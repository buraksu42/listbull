/**
 * `GET  /api/workspaces` — list every workspace the caller belongs to,
 *                          with role + tier + counts. Powers the Mini
 *                          App switcher dropdown.
 *
 * `POST /api/workspaces`  — create a new workspace owned by the caller.
 *                          Tier middleware logs the attempt; Phase 5
 *                          flips to active enforcement.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  listWorkspacesForUser,
  slugify,
} from "@/lib/db/queries/workspaces";
import { TIER_LIMITS, type WorkspaceTier } from "@/lib/types";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const rows = await listWorkspacesForUser(userId);
  return NextResponse.json({ ok: true, data: { workspaces: rows } });
}

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
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

  const parsed = body as { name?: unknown };
  if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: "name (1-120) is required" },
      },
      { status: 400 },
    );
  }
  const name = parsed.name.trim().slice(0, 120);

  // Tier check: workspace creation beyond Personal requires Team or
  // Workspace tier. Phase 4.5 logs only.
  const tierResult = await enforceTier("", { type: "create_workspace" });
  if (tierResult.enforced) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: tierResult.reason,
          message: tierResult.message,
          upgradeTo: tierResult.upgradeTo,
        },
      },
      { status: 402 },
    );
  }

  const tier: WorkspaceTier = "free";
  const slug = slugify(name) || `ws-${userId.slice(0, 8)}`;

  const created = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(workspaces)
      .values({
        name,
        slug,
        tier,
        isPersonal: false,
        ownerId: userId,
        memberLimit: TIER_LIMITS[tier].memberLimit,
      })
      .returning();
    if (!w) throw new Error("create-workspace: insert returned no row");

    await tx.insert(workspaceMembers).values({
      workspaceId: w.id,
      userId,
      role: "owner",
    });

    return w;
  });

  return NextResponse.json({
    ok: true,
    data: {
      workspace: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        tier: created.tier,
        isPersonal: created.isPersonal,
      },
    },
  });
}
