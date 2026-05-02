/**
 * Phase 4 e2e: Mini App auth flow.
 *
 * Walks through the initData → session → /lists path. Mocks
 * `window.Telegram.WebApp` via Playwright's `addInitScript` so the
 * Frontend's @telegram-apps/sdk-react adapter sees a populated bridge
 * before any client React runs.
 */
import { test, expect } from "@playwright/test";

import { LIVE, buildInitData } from "./_utils";

test.describe("Mini App auth flow", () => {
  test.skip(
    !LIVE,
    "Skipped: requires LISTGRAM_E2E_LIVE=1 + a running server with TELEGRAM_BOT_TOKEN configured (Phase 5 staging gate).",
  );

  test("initData → session → /lists landing", async ({ page }) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      test.skip(true, "TELEGRAM_BOT_TOKEN env var not set");
      return;
    }

    const initData = buildInitData({
      botToken,
      user: {
        id: 999_999_001,
        first_name: "PlaywrightUser",
        username: "playwright_user",
        language_code: "tr",
      },
    });

    await page.addInitScript((data: string) => {
      // The @telegram-apps/sdk-react initializer reads
      // window.Telegram.WebApp.initData on first paint.
      (window as unknown as { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: data,
          initDataUnsafe: {},
          ready: () => undefined,
          expand: () => undefined,
          close: () => undefined,
          MainButton: { hide: () => undefined, show: () => undefined },
          BackButton: { hide: () => undefined, show: () => undefined },
          themeParams: {},
          colorScheme: "light",
        },
      };
    }, initData);

    await page.goto("/app");
    // Auth interstitial settles → /lists.
    await page.waitForURL("**/lists", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/lists/);
  });
});
