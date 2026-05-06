/**
 * D2 — HMAC signing helper for shareable list snapshot URLs (Phase 4).
 *
 * Inv-18: snapshot URLs sign `${listId}:${exp}` (where `exp` is unix-ms)
 * using HMAC-SHA256 with `SNAPSHOT_SIGNING_KEY` (or `BETTER_AUTH_SECRET`
 * when the dedicated key is unset). The HMAC output is base64url-encoded.
 *
 * URL shape (consumed by `(marketing)/snapshot/[id]`):
 *   /snapshot/<listId>?exp=<unix-ms>&token=<base64url(hmac)>
 *
 * Verification:
 *   1. Reject if `exp <= now()` (410 Gone).
 *   2. Recompute HMAC and constant-time compare with `?token=`.
 *   3. Load list and render.
 *
 * URLs are never re-issued on access — to "refresh" a snapshot, the
 * owner generates a new URL via `/snapshot` or the share sheet.
 */
import "server-only";

import crypto from "node:crypto";

import { env } from "@/lib/env";

/** Default expiration window: 30 days from generation. */
export const DEFAULT_SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingKey(): string {
  return env.SNAPSHOT_SIGNING_KEY ?? env.BETTER_AUTH_SECRET;
}

/** Pure HMAC computation — exported for tests. */
export function computeSnapshotHmac(listId: string, expUnixMs: number): string {
  return crypto
    .createHmac("sha256", signingKey())
    .update(`${listId}:${expUnixMs}`)
    .digest("base64url");
}

/**
 * Generate a signed snapshot URL for a list. Returns the absolute URL
 * the bot/Frontend can ship to the user. `expiresAt` is exposed for
 * downstream display + the ExportBundle if needed.
 */
export function generateSnapshotUrl(
  listId: string,
  ttlMs: number = DEFAULT_SNAPSHOT_TTL_MS,
): { url: string; exp: number; expiresAt: string } {
  const exp = Date.now() + ttlMs;
  const token = computeSnapshotHmac(listId, exp);
  const url = `${env.NEXT_PUBLIC_APP_URL}/snapshot/${listId}?exp=${exp}&token=${token}`;
  return {
    url,
    exp,
    expiresAt: new Date(exp).toISOString(),
  };
}

/**
 * Verify a snapshot URL's `?exp=&?token=` query params. Returns the
 * reason for rejection so the route handler can pick the right HTTP
 * status:
 *   - "expired" → 410 Gone
 *   - "invalid" → 404 (don't leak existence)
 *   - "ok" → caller proceeds with snapshot read
 *
 * Constant-time compare via `timingSafeEqual` (same length first).
 */
export function verifySnapshotToken(
  listId: string,
  expRaw: string | null,
  tokenRaw: string | null,
): { ok: true } | { ok: false; reason: "expired" | "invalid" } {
  if (!expRaw || !tokenRaw) return { ok: false, reason: "invalid" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= 0) {
    return { ok: false, reason: "invalid" };
  }
  if (exp <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const expected = computeSnapshotHmac(listId, exp);
  if (expected.length !== tokenRaw.length) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(tokenRaw, "utf8");
    if (a.length !== b.length) {
      return { ok: false, reason: "invalid" };
    }
    if (!crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "invalid" };
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}
