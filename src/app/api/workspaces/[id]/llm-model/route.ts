/**
 * `GET  /api/workspaces/[id]/llm-model` — read the workspace's LLM
 *                                        model. Member-gated read.
 * `PUT  /api/workspaces/[id]/llm-model` — set the workspace's LLM
 *                                        model. Owner-only write.
 *
 * Schema: `workspaces.llm_model` (text, NOT NULL, default
 * "google/gemini-2.5-flash"). Validated against the same allowlist
 * as the legacy /api/settings LLM picker.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { ALLOWED_LLM_MODELS } from "@/lib/validators/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

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
    .select({ llmModel: workspaces.llmModel })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Workspace not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, data: { llmModel: row.llmModel } });
}

const putBodySchema = z.object({
  llmModel: z.enum(ALLOWED_LLM_MODELS),
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
        error: { code: "forbidden", message: "Only owners can change the workspace LLM model." },
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
    .set({ llmModel: parsed.data.llmModel, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));

  return NextResponse.json({
    ok: true,
    data: { llmModel: parsed.data.llmModel },
  });
}
