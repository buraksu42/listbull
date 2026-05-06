/**
 * Phase 4 e2e: bot intent → item creation.
 *
 * Synthesizes a Telegram Update payload, POSTs it to
 * `/api/telegram/webhook` with the correct `X-Telegram-Bot-Api-Secret-Token`
 * header, and asserts the bot replies (200) and that an `item_created`
 * row appears for the simulated user.
 *
 * Live verification of the row requires DB access from the test runner;
 * Phase 5 staging spins up a dedicated test DB whose creds are exposed
 * via `LISTBULL_E2E_DATABASE_URL`. Until then, this spec asserts the
 * webhook responds 200 (Inv-9 + signature gate working).
 */
import { test, expect, request } from "@playwright/test";

import { LIVE, makeTextUpdate } from "./_utils";

test.describe("bot intent → webhook", () => {
  test.skip(
    !LIVE,
    "Skipped: requires LISTBULL_E2E_LIVE=1 + running server with TELEGRAM_WEBHOOK_SECRET (Phase 5 staging gate).",
  );

  test("webhook accepts a signed POST and returns 200 within 60s", async ({
    baseURL,
  }) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
      test.skip(true, "TELEGRAM_WEBHOOK_SECRET env var not set");
      return;
    }
    const ctx = await request.newContext({ baseURL });
    const body = makeTextUpdate({
      text: "Add 'milk' to my Inbox",
      fromTelegramId: 999_999_002,
      firstName: "PlaywrightBot",
    });

    const response = await ctx.post("/api/telegram/webhook", {
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      data: body,
      timeout: 60_000,
    });
    expect(response.status()).toBe(200);
  });

  test("webhook rejects requests missing the secret-token header", async ({
    baseURL,
  }) => {
    const ctx = await request.newContext({ baseURL });
    const response = await ctx.post("/api/telegram/webhook", {
      data: makeTextUpdate({
        text: "Add 'milk' to my Inbox",
        fromTelegramId: 999_999_003,
      }),
    });
    // Without the secret header → 401/403 (Inv-9 gate).
    expect([401, 403]).toContain(response.status());
  });
});
