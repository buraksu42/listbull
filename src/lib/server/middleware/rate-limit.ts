/**
 * Per-route rate limiting (Phase 7).
 *
 * Backed by Upstash Ratelimit when the env is configured; no-op
 * fallback otherwise. Sliding-window strategy with a key derived
 * from caller identity (admin token, user id, or IP — caller's
 * choice).
 *
 * Helper returns a discriminated union so the caller decides whether
 * to 429 or pass through. Limits are intentionally route-specific:
 * admin issuance is sensitive (low limit), billing checkout is
 * user-driven (medium limit), webhooks have no caller-controllable
 * key + are signature-gated (no limit needed).
 */
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";

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

const limiterCache = new Map<string, Ratelimit>();

function getLimiter(
  scope: string,
  tokens: number,
  windowSeconds: number,
): Ratelimit | null {
  const key = `${scope}:${tokens}:${windowSeconds}`;
  const cached = limiterCache.get(key);
  if (cached) return cached;
  const redis = getRedis();
  if (!redis) return null;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, `${windowSeconds} s`),
    analytics: false,
    prefix: `lb-rl:${scope}`,
  });
  limiterCache.set(key, limiter);
  return limiter;
}

export type RateLimitResult =
  | { limited: false; remaining: number; reset: number }
  | { limited: true; reason: "rate_limited"; reset: number };

export type EnforceRateLimitArgs = {
  /** Logical scope name; e.g. 'admin-license-issue', 'billing-checkout'. */
  scope: string;
  /** Caller key — admin token, userId, IP, etc. */
  identifier: string;
  /** Allowed events per window. */
  tokens: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * Check + decrement the limiter. When Upstash isn't configured,
 * returns `{ limited: false, remaining: Infinity, reset: 0 }` so the
 * caller proceeds — rate limiting is opt-in.
 */
export async function enforceRateLimit(
  args: EnforceRateLimitArgs,
): Promise<RateLimitResult> {
  const limiter = getLimiter(args.scope, args.tokens, args.windowSeconds);
  if (!limiter) {
    return {
      limited: false,
      remaining: Number.POSITIVE_INFINITY,
      reset: 0,
    };
  }
  const { success, remaining, reset } = await limiter.limit(args.identifier);
  if (success) return { limited: false, remaining, reset };
  return { limited: true, reason: "rate_limited", reset };
}

/**
 * Webhook idempotency: mark a Telegram `update_id` as seen so a
 * replay (same secret-token-bearing request, captured by an
 * attacker) doesn't re-process the update. Uses SET NX with a
 * 1-hour TTL — Telegram retries within seconds, so an hour of
 * memory is plenty.
 *
 * Returns `true` if this is the first time we've seen the id (proceed),
 * `false` if it's a duplicate (caller should ack without reprocessing).
 * When Upstash isn't configured, always returns `true` (no
 * protection but also no spurious blocks).
 */
export async function markUpdateSeen(updateId: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const key = `lb-update-seen:${updateId}`;
  const res = await redis.set(key, 1, { nx: true, ex: 3600 });
  return res === "OK";
}
