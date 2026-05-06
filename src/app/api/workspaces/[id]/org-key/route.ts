/**
 * Workspace org-level OpenRouter key management (Phase 5.5 / G6).
 *
 * Workspace-tier admins can SET / REPLACE / CLEAR an OpenRouter
 * key shared across the workspace. Members without personal BYOK
 * fall back to this key during LLM calls — see
 * src/lib/server/bot/handle-message.ts BYOK resolution chain.
 *
 *   GET  → returns hasOrgKey: boolean (never the key itself)
 *   PUT  → set/replace; body { apiKey: string }
 *   DELETE → clear
 *
 * Owner + admin only. Workspace tier only — the
 * `set_org_api_key` tier action gates non-Workspace tiers.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { encrypt } from "@/lib/server/encryption";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";

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
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only owners and admins can manage the workspace API key.",
        },
      },
      { status: 403 },
    );
  }

  // Tier gate: Workspace tier only. Phase 5 BILLING_ENFORCE flips
  // this from logged to enforcing.
  const tierResult = await enforceTier(workspaceId, {
    type: "set_org_api_key",
  });
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

  return { userId };
}

export async function GET(_request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;

  const [row] = await db
    .select({
      tier: workspaces.tier,
      keyEnc: workspaces.openrouterApiKeyEncrypted,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      hasOrgKey: row.keyEnc !== null,
      tier: row.tier,
    },
  });
}

export async function PUT(request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const { apiKey } = body as { apiKey?: unknown };
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "apiKey is required and must be a non-empty string",
        },
      },
      { status: 400 },
    );
  }

  const encrypted = encrypt(apiKey.trim());
  await db
    .update(workspaces)
    .set({
      openrouterApiKeyEncrypted: encrypted,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({
    ok: true,
    data: { hasOrgKey: true },
  });
}

export async function DELETE(_request: Request, { params }: RouteCtx) {
  const { id: workspaceId } = await params;
  const auth = await authorize(workspaceId);
  if (auth instanceof NextResponse) return auth;

  await db
    .update(workspaces)
    .set({
      openrouterApiKeyEncrypted: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({ ok: true, data: { hasOrgKey: false } });
}
