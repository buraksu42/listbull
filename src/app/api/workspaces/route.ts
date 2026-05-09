/**
 * `GET  /api/workspaces` — list every workspace the caller belongs to.
 *                          Powers the Mini App switcher dropdown.
 *
 * `POST /api/workspaces`  — create a new workspace owned by the caller.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  listWorkspacesForUser,
  slugify,
} from "@/lib/db/queries/workspaces";

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
  const slug = slugify(name) || `ws-${userId.slice(0, 8)}`;

  const created = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(workspaces)
      .values({
        name,
        slug,
        isPersonal: false,
        ownerId: userId,
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
        isPersonal: created.isPersonal,
      },
    },
  });
}
