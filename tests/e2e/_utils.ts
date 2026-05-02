import crypto from "node:crypto";

/**
 * Phase 4 e2e helpers shared by every spec file.
 *
 * The strict-gate Phase 4 contract demands these tests EXIST and the
 * Playwright config compiles. Live execution requires:
 *
 *   - A reachable Next.js server (LISTGRAM_E2E_BASE_URL or default
 *     http://127.0.0.1:3000) backed by a real Postgres.
 *   - A real Telegram bot token + webhook secret in the server's env.
 *   - LISTGRAM_E2E_LIVE=1 to flip every spec from `test.skip` to
 *     `test.fixme` where unimplemented or `test()` where ready.
 *
 * Phase 5 staging flips that flag on. Until then, the suite is a
 * compile-time + structure baseline.
 */
export const LIVE = process.env.LISTGRAM_E2E_LIVE === "1";

/**
 * Build a Telegram Mini App `initData` query string signed with the
 * given bot token. Mirrors the production verifier's algorithm so a
 * Playwright test can pass real-shaped `initData` to the page via
 * `addInitScript`.
 */
export function buildInitData(opts: {
  botToken: string;
  user: {
    id: number;
    first_name: string;
    username?: string;
    language_code?: string;
  };
  authDateSec?: number;
}): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(opts.user));
  params.set(
    "auth_date",
    String(opts.authDateSec ?? Math.floor(Date.now() / 1000)),
  );
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(opts.botToken)
    .digest();
  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

/**
 * A minimal Telegram Update payload shape — extend as more specs
 * exercise different update types.
 */
export type TelegramTextUpdate = {
  update_id: number;
  message: {
    message_id: number;
    from: {
      id: number;
      is_bot: false;
      first_name: string;
      language_code?: string;
    };
    chat: { id: number; type: "private" };
    date: number;
    text: string;
  };
};

export function makeTextUpdate(args: {
  text: string;
  fromTelegramId: number;
  firstName?: string;
}): TelegramTextUpdate {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: Math.floor(Math.random() * 1_000_000),
      from: {
        id: args.fromTelegramId,
        is_bot: false,
        first_name: args.firstName ?? "Tester",
        language_code: "tr",
      },
      chat: { id: args.fromTelegramId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: args.text,
    },
  };
}
