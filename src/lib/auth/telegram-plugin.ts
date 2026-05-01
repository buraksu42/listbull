import crypto from "node:crypto";

/**
 * Telegram Mini App initData HMAC-SHA256 verification.
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Algorithm:
 * 1. Parse the initData query string into key-value pairs.
 * 2. Pull the `hash` parameter aside.
 * 3. Sort remaining keys alphabetically and join as `key=value\n...`.
 * 4. Derive secret = HMAC_SHA256("WebAppData", botToken).
 * 5. Compute HMAC_SHA256(secret, dataCheckString); compare in constant time to the provided hash.
 * 6. Reject if `auth_date` is older than 24h (Telegram convention).
 */

export type TelegramInitDataUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type VerifiedInitData = {
  user: TelegramInitDataUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
  raw: string;
};

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeMs?: number } = {},
): VerifiedInitData {
  if (!initData) throw new Error("initData is empty");
  if (!botToken) throw new Error("bot token is empty");

  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  if (!providedHash) throw new Error("initData missing 'hash' parameter");

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => [key, value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const ok = constantTimeEqualHex(computed, providedHash);
  if (!ok) throw new Error("initData hash mismatch — verification failed");

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) throw new Error("initData missing 'auth_date'");
  const authDateSec = Number(authDateRaw);
  if (!Number.isFinite(authDateSec)) {
    throw new Error("initData 'auth_date' is not a number");
  }
  const authDate = new Date(authDateSec * 1000);
  const ageMs = Date.now() - authDate.getTime();
  const maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
  if (ageMs > maxAgeMs) {
    throw new Error(`initData expired (age ${ageMs}ms > max ${maxAgeMs}ms)`);
  }

  const userJson = params.get("user");
  if (!userJson) throw new Error("initData missing 'user' field");
  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userJson) as TelegramInitDataUser;
  } catch {
    throw new Error("initData 'user' is not valid JSON");
  }
  if (typeof user.id !== "number" || typeof user.first_name !== "string") {
    throw new Error("initData 'user' missing required fields");
  }

  return {
    user,
    authDate,
    queryId: params.get("query_id") ?? undefined,
    startParam: params.get("start_param") ?? undefined,
    raw: initData,
  };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
