/**
 * `GET /api/snapshot/[id]?exp=<unix-ms>&token=<base64url-hmac>` — Phase
 * 4 / D2 public snapshot read endpoint.
 *
 * The `(marketing)/snapshot/[id]` page can read this directly from
 * SSR fetch OR client-fetch as needed; either way the HMAC is the
 * sole auth surface (Inv-18). No session cookie is required.
 *
 * Status codes:
 *   - 200 → snapshot
 *   - 404 → list missing OR token invalid (don't leak existence)
 *   - 410 → token valid but expired
 */
import { NextResponse } from "next/server";

import { getSnapshotPublic } from "@/lib/db/queries/snapshots";
import { verifySnapshotToken } from "@/lib/server/lists/snapshot-token";
import type { GetSnapshotResponse } from "@/lib/validators/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteCtx) {
  const { id } = await params;
  const url = new URL(request.url);
  const exp = url.searchParams.get("exp");
  const token = url.searchParams.get("token");

  const verdict = verifySnapshotToken(id, exp, token);
  if (!verdict.ok) {
    if (verdict.reason === "expired") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "snapshot_expired",
            message: "This snapshot link has expired.",
          },
        },
        { status: 410 },
      );
    }
    // invalid → 404 to avoid leaking list existence.
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  const expIso = new Date(Number(exp)).toISOString();
  const snapshot = await getSnapshotPublic(id, expIso);
  if (!snapshot) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  const data: GetSnapshotResponse = { snapshot };
  return NextResponse.json({ ok: true, data });
}
