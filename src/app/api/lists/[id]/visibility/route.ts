/**
 * `PATCH /api/lists/[id]/visibility` — toggle a list's public/private
 * visibility (Phase 16/#28).
 *
 * Permission: list owner only. Workspace owner can promote themselves
 * to list owner via the existing /share flow OR ask the bot
 * (`@listbull_bot <list>'i public yap`) — keeping API surface tight.
 *
 * Writes an activity_log row so the change shows up in audit/feed.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { isListOwner } from "@/lib/db/queries/members";
import { activityLog, lists } from "@/lib/db/schema";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { toListSnapshot } from "@/lib/db/snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  visibility: z.enum(["public", "private"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id: listId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: parsed.error.message } },
      { status: 400 },
    );
  }

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const current = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.workspaceId, workspaceId)),
  });
  if (!current) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const isOwner = await isListOwner(userId, listId);
  if (!isOwner) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "Only the list owner can change visibility.",
        },
      },
      { status: 403 },
    );
  }

  if (current.visibility === parsed.data.visibility) {
    // Idempotent no-op; skip activity_log.
    return NextResponse.json({
      ok: true,
      data: { visibility: current.visibility },
    });
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(lists)
      .set({ visibility: parsed.data.visibility, updatedAt: new Date() })
      .where(eq(lists.id, listId))
      .returning();
    if (!updated) {
      throw new Error("visibility PATCH: update returned no row");
    }
    await tx.insert(activityLog).values({
      listId: listId,
      entityType: "list",
      entityId: listId,
      action: "list_renamed", // schema uses list_renamed for any list-shell mutation
      actorId: userId,
      payloadBefore: toListSnapshot(current),
      payloadAfter: toListSnapshot(updated),
    });
    return updated;
  });

  return NextResponse.json({
    ok: true,
    data: { visibility: result.visibility as "public" | "private" },
  });
}
