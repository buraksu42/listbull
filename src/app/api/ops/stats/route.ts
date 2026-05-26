/**
 * GET /api/ops/stats — JSON form of the brand-owner dashboard.
 *
 * Gated by `src/middleware.ts` (HTTP basic-auth). Shares the same
 * `getOpsStats()` helper as `/ops`, so the page and the API can't
 * drift. No caching — counters are point-in-time and change every
 * tick of bot activity.
 *
 * Accepts `?window=7|30|90` to scope window-bound metrics
 * (throughput, activity, velocity, retention, tags, attachments).
 * Default 7. Anything outside the whitelist falls back to 7.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getOpsStats, parseOpsWindow } from "@/lib/db/queries/ops";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const window = parseOpsWindow(
    req.nextUrl.searchParams.get("window") ?? undefined,
  );
  const stats = await getOpsStats(window);
  return NextResponse.json(stats, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
