/**
 * Webhook idempotency layer.
 *
 * Phase 7: when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are
 * configured, uses Upstash KV with SET ... NX EX for cross-pod
 * safety. When unset, falls back to the original in-memory Map
 * (single-pod safe; Phase 4.5 default).
 *
 * Both paths share the 24h TTL window and the boolean "is replay"
 * return contract. Webhook handlers don't need to care which backend
 * is active.
 */
import "server-only";

import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TTL_SECONDS = 24 * 60 * 60;

// In-memory fallback (Phase 4.5 single-pod default).
const seen = new Map<string, number>();

let cachedRedis: Redis | null = null;
function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  cachedRedis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return cachedRedis;
}

/**
 * Returns `true` if the event has been seen within the TTL window;
 * `false` otherwise (and records the event). Safe to call repeatedly
 * — repeat calls with the same key inside TTL all return true after
 * the first.
 *
 * Async to accommodate Upstash; in-memory path resolves
 * synchronously inside a Promise.resolve.
 */
export async function isReplay(eventId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `webhook:${eventId}`;

  if (redis) {
    // SET key value NX EX returns "OK" on first write, null on replay.
    const result = await redis.set(key, "1", { nx: true, ex: TTL_SECONDS });
    return result === null;
  }

  // In-memory fallback (single-pod).
  const now = Date.now();
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }
  const ts = seen.get(eventId);
  if (ts !== undefined && now - ts <= TTL_MS) return true;
  seen.set(eventId, now);
  return false;
}

/** Test helper — clears the in-memory cache. */
export function _resetForTests(): void {
  seen.clear();
}
