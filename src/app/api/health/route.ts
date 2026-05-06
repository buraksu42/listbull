import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public health endpoint. UptimeRobot keyword check matches `"status":"ok"`.
 * Must be auth-exempt — basic-auth or session gate would break uptime monitoring.
 */
export async function GET() {
  let dbStatus: "ok" | "error" = "ok";

  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    console.error("[health] db ping failed", error);
    dbStatus = "error";
  }

  const body = {
    status: dbStatus === "ok" ? "ok" : "degraded",
    db: dbStatus,
    ts: Date.now(),
  } as const;

  return NextResponse.json(body, {
    status: dbStatus === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
