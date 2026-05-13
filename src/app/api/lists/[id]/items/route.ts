import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUserId } from "@/lib/auth/session";
import {
  getList,
  listItemsInList,
  userCanReadList,
} from "@/lib/db/queries/lists";
import { userCanWriteList } from "@/lib/db/queries/items";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
import { executeCreateItem } from "@/lib/server/tools/create-item";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  const { id } = await params;

  const workspaceId = await resolveActiveWorkspaceId(userId);
  const canRead = await userCanReadList(userId, id, workspaceId);
  if (!canRead) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const list = await getList(id);
  if (!list) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "List not found" } },
      { status: 404 },
    );
  }

  const items = await listItemsInList(id);
  return NextResponse.json({ ok: true, data: { list, items } });
}

const postBodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

/**
 * `POST /api/lists/[id]/items` — Mini App quick-add path. Writes one
 * item to the list using the same executor the LLM tool calls, so
 * permissions, transactions, and activity_log behave identically.
 * No reminders / deadlines / tags here — that's the edit-sheet's job.
 */
export async function POST(
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
  const workspaceId = await resolveActiveWorkspaceId(userId);
  const canWrite = await userCanWriteList(userId, listId, workspaceId);
  if (!canWrite) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "forbidden",
          message: "You can't add items to this list.",
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
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: parsed.error.message } },
      { status: 400 },
    );
  }

  const result = await executeCreateItem(
    { text: parsed.data.text, list_id: listId },
    { userId, workspaceId },
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  // Fetch the persisted row so the client gets the full Item shape
  // (position, created_at, etc.) for optimistic insert reconciliation.
  const all = await listItemsInList(listId);
  const fresh = all.find((it) => it.id === result.data.item.id);
  return NextResponse.json({ ok: true, data: { item: fresh ?? null } });
}
