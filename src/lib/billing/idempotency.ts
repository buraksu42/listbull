/**
 * Webhook idempotency layer.
 *
 * Phase 4.5: in-memory Map (per-pod), 24h TTL. Acceptable for single-
 * pod Dokploy deployments — replays of the same Stripe event ID
 * within 24h get skipped. Phase 5 swaps to Upstash KV for multi-pod
 * safety once SaaS scales beyond one container.
 *
 * The architect spec calls Upstash KV; deferring the dependency add
 * until Phase 5 keeps Phase 4.5 deps minimal.
 */
import "server-only";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const seen = new Map<string, number>();

/**
 * Returns `true` if the event has been seen within the TTL window;
 * `false` otherwise (and records the event). Safe to call repeatedly
 * — repeat calls with the same key inside TTL all return true after
 * the first.
 */
export function isReplay(eventId: string): boolean {
  const now = Date.now();
  // Sweep expired entries opportunistically — keeps the map bounded.
  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }

  const ts = seen.get(eventId);
  if (ts !== undefined && now - ts <= TTL_MS) return true;
  seen.set(eventId, now);
  return false;
}

/** Test helper — clears the cache. Not exported for production code. */
export function _resetForTests(): void {
  seen.clear();
}
