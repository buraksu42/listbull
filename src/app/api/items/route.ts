/**
 * Mini App items API — POST /api/items.
 *
 * Reuses `executeCreateItem` so the bot tool path and the Mini App
 * manual-create path share one implementation (Inv-1 transactional
 * write + activity_log row guarantee for both surfaces).
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { executeCreateItem } from "@/lib/server/tools/create-item";
import { createItemBodySchema } from "@/lib/validators/items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = createItemBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_input", message: parsed.error.message },
      },
      { status: 400 },
    );
  }

  // Translate Mini App body shape into the executor's input shape (the
  // executor's input mirrors AI's tool schema with snake_case keys).
  const { text, listId, listName, dueAt, isCheckable } = parsed.data;
  const result = await executeCreateItem(
    {
      text,
      list_id: listId,
      list_name: listName,
      due_at: dueAt,
      is_checkable: isCheckable,
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
    case "invalid_input":
    case "bad_input":
      return 400;
    default:
      return 500;
  }
}
