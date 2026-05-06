/**
 * Per-license admin operations:
 *
 *   DELETE /api/admin/licenses/[id]            — revoke (set revoked_at)
 *   GET    /api/admin/licenses/[id]/jwt        — re-fetch JWT (separate
 *                                                route to avoid surfacing
 *                                                in the list endpoint)
 */
import { NextResponse } from "next/server";

import { revokeLicense } from "@/lib/billing/license";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_HEADER = "x-listbull-admin-token";

type RouteCtx = { params: Promise<{ id: string }> };

function authorize(request: Request): NextResponse | null {
  if (!env.LICENSE_ADMIN_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "service_unavailable",
          message: "License admin token not configured.",
        },
      },
      { status: 503 },
    );
  }
  const provided = request.headers.get(ADMIN_HEADER);
  if (provided !== env.LICENSE_ADMIN_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Invalid admin token" },
      },
      { status: 401 },
    );
  }
  return null;
}

export async function DELETE(request: Request, { params }: RouteCtx) {
  const auth = authorize(request);
  if (auth) return auth;

  const { id } = await params;
  const ok = await revokeLicense(id);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "License not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, data: { revokedAt: new Date().toISOString() } });
}
