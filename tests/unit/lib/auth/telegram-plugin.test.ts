/**
 * Telegram Mini App initData verification tests.
 *
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Phase 4 strict gate: HMAC verify success / tampered / expired (>24h).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyTelegramInitData } from "@/lib/auth/telegram-plugin";

const BOT_TOKEN = "123456:test-bot-token-vitest-fixture";

/**
 * Build a valid `initData` query string for `botToken`. We mirror the
 * Mini App spec exactly: data-check string is sorted key=value pairs
 * joined by `\n`; the secret is HMAC_SHA256("WebAppData", botToken);
 * the hash is HMAC_SHA256(secret, dataCheckString) hex-encoded.
 */
function makeInitData(opts: {
  user: object;
  authDateSec?: number;
  startParam?: string;
  queryId?: string;
  tamperHash?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(opts.user));
  params.set(
    "auth_date",
    String(opts.authDateSec ?? Math.floor(Date.now() / 1000)),
  );
  if (opts.queryId) params.set("query_id", opts.queryId);
  if (opts.startParam) params.set("start_param", opts.startParam);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  params.set(
    "hash",
    opts.tamperHash
      ? hash.replace(/^./, hash[0] === "a" ? "b" : "a")
      : hash,
  );
  return params.toString();
}

const VALID_USER = {
  id: 42,
  first_name: "Burak",
  username: "buraksu",
  language_code: "tr",
};

describe("verifyTelegramInitData — happy path", () => {
  it("returns the parsed VerifiedInitData on a valid signature", () => {
    const initData = makeInitData({ user: VALID_USER });
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.user.id).toBe(42);
    expect(result.user.first_name).toBe("Burak");
    expect(result.authDate).toBeInstanceOf(Date);
    expect(result.raw).toBe(initData);
  });

  it("preserves start_param and query_id when present", () => {
    const initData = makeInitData({
      user: VALID_USER,
      startParam: "list-abc",
      queryId: "q-1",
    });
    const result = verifyTelegramInitData(initData, BOT_TOKEN);
    expect(result.startParam).toBe("list-abc");
    expect(result.queryId).toBe("q-1");
  });
});

describe("verifyTelegramInitData — rejection paths", () => {
  it("rejects empty initData", () => {
    expect(() => verifyTelegramInitData("", BOT_TOKEN)).toThrow(/empty/);
  });

  it("rejects missing bot token", () => {
    const initData = makeInitData({ user: VALID_USER });
    expect(() => verifyTelegramInitData(initData, "")).toThrow(/bot token/);
  });

  it("rejects when hash field is missing", () => {
    const params = new URLSearchParams({
      user: JSON.stringify(VALID_USER),
      auth_date: String(Math.floor(Date.now() / 1000)),
    });
    expect(() => verifyTelegramInitData(params.toString(), BOT_TOKEN)).toThrow(
      /missing 'hash'/,
    );
  });

  it("rejects a tampered hash (constant-time mismatch)", () => {
    const initData = makeInitData({ user: VALID_USER, tamperHash: true });
    expect(() => verifyTelegramInitData(initData, BOT_TOKEN)).toThrow(
      /hash mismatch/,
    );
  });

  it("rejects when signed under a different bot token", () => {
    const initData = makeInitData({ user: VALID_USER });
    expect(() =>
      verifyTelegramInitData(initData, "different:bot-token"),
    ).toThrow(/hash mismatch/);
  });

  it("rejects auth_date older than 24h (default maxAge)", () => {
    // 25 hours ago.
    const stale = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const initData = makeInitData({ user: VALID_USER, authDateSec: stale });
    expect(() => verifyTelegramInitData(initData, BOT_TOKEN)).toThrow(
      /expired/,
    );
  });

  it("respects maxAgeMs override", () => {
    // 2 minutes ago, but cap is 60s.
    const slightlyStale = Math.floor(Date.now() / 1000) - 120;
    const initData = makeInitData({
      user: VALID_USER,
      authDateSec: slightlyStale,
    });
    expect(() =>
      verifyTelegramInitData(initData, BOT_TOKEN, { maxAgeMs: 60_000 }),
    ).toThrow(/expired/);
  });

  it("rejects malformed user JSON", () => {
    const params = new URLSearchParams();
    params.set("user", "{not-json");
    params.set("auth_date", String(Math.floor(Date.now() / 1000)));
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();
    const hash = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");
    params.set("hash", hash);
    expect(() =>
      verifyTelegramInitData(params.toString(), BOT_TOKEN),
    ).toThrow(/not valid JSON/);
  });
});
