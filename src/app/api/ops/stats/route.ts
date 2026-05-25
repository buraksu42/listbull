/**
 * GET /api/ops/stats — JSON form of the brand-owner dashboard.
 *
 * Gated by `src/middleware.ts` (HTTP basic-auth). Shares the same
 * `getOpsStats()` helper as `/ops`, so the page and the API can't
 * drift. No caching — counters are point-in-time and change every
 * tick of bot activity.
 */
import { NextResponse } from "next/server";

import { getOpsStats } from "@/lib/db/queries/ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  const stats = await getOpsStats();
  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
