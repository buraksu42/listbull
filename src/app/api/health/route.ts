import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

import { db } from "@/lib/db/client";
import { getBot } from "@/lib/server/bot";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubsystemStatus = "ok" | "error" | "skipped";

/**
 * Public health endpoint. UptimeRobot keyword check matches
 * `"status":"ok"` — we keep top-level status='ok' as long as the
 * REQUIRED subsystems are healthy (db + bot). Optional subsystems
 * (Redis) surface in the JSON for operator visibility but don't
 * fail the keyword check.
 *
 * Auth-exempt — basic-auth or session gate breaks uptime monitoring.
 */
export async function GET() {
  const dbStatus = await pingDb();
  const botStatus = await pingBot();
  const redisStatus = await pingRedis();

  // Top-level "ok" = required subsystems healthy. Optional ones
  // affect the json detail but not the keyword.
  const allRequiredOk = dbStatus === "ok" && botStatus === "ok";

  const body = {
    status: allRequiredOk ? "ok" : "degraded",
    db: dbStatus,
    bot: botStatus,
    redis: redisStatus,
    ts: Date.now(),
  } as const;

  return NextResponse.json(body, {
    status: allRequiredOk ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}

async function pingDb(): Promise<SubsystemStatus> {
  try {
    await db.execute(sql`select 1`);
    return "ok";
  } catch (error) {
    console.error("[health] db ping failed", error);
    return "error";
  }
}

async function pingBot(): Promise<SubsystemStatus> {
  try {
    const bot = await getBot();
    // grammY's bot.init() ran in the pool; getMe is a cheap echo.
    await bot.api.getMe();
    return "ok";
  } catch (error) {
    console.error("[health] bot ping failed", error);
    return "error";
  }
}

async function pingRedis(): Promise<SubsystemStatus> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return "skipped";
  }
  try {
    const r = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
    await r.ping();
    return "ok";
  } catch (error) {
    console.error("[health] redis ping failed", error);
    return "error";
  }
}
