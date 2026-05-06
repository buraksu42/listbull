/**
 * `GET /api/license-revocations` — public newline-separated list
 * of revoked license IDs. Self-host instances poll this URL
 * (configured as LICENSE_REVOCATION_URL on their side) every hour
 * to refresh their local revocation cache.
 *
 * No auth — the response only reveals license IDs (UUIDs that are
 * already inside revoked JWTs handed to operators); no other
 * customer data leaks. Cached for 1 minute at the edge to absorb
 * burst polls.
 */
import { NextResponse } from "next/server";

import { buildRevocationList } from "@/lib/billing/license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = await buildRevocationList();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
    },
  });
}
