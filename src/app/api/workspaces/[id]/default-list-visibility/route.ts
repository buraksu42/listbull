/**
 * `GET  /api/workspaces/[id]/default-list-visibility` — read the
 *                                                       workspace's
 *                                                       new-list
 *                                                       default.
 *                                                       Member-gated.
 * `PUT  /api/workspaces/[id]/default-list-visibility` — owner-only
 *                                                       write.
 *
 * Schema: `workspaces.default_list_visibility` (text, NOT NULL,
 * default 'private'). Phase 16/#28.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const VisibilityEnum = z.enum(["public", "private"]);

export async function GET(_request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }

  const [row] = await db
    .select({ defaultListVisibility: workspaces.defaultListVisibility })
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
    data: { defaultListVisibility: row.defaultListVisibility },
  });
}

const putBodySchema = z.object({
  defaultListVisibility: VisibilityEnum,
});

export async function PUT(request: Request, { params }: RouteCtx) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: workspaceId } = await params;
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only owners can change the default list visibility.",
        },
      },
      { status: 403 },
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
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: parsed.error.message } },
      { status: 400 },
    );
  }

  await db
    .update(workspaces)
    .set({
      defaultListVisibility: parsed.data.defaultListVisibility,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({
    ok: true,
    data: { defaultListVisibility: parsed.data.defaultListVisibility },
  });
}
