import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — Phase 4 e2e surface.
 *
 * Tests live under `tests/e2e/**`. The full suite (Mini App auth flow,
 * mocked-webhook intent, share flow, restore flow) is authored in
 * Phase 4; live execution is gated behind `LISTGRAM_E2E_LIVE=1` so CI
 * can ship a green smoke run without provisioning a Postgres + bot
 * webhook in the orchestrator's environment. Phase 5 staging flips the
 * gate on after DNS + bot token + DB are wired.
 *
 * Local dev: `LISTGRAM_E2E_LIVE=1 npx playwright test` against a
 * `npm run dev` server with `.env.local` populated.
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Webserver auto-start is OFF by default — test runs against an
  // already-up dev/staging deploy. Set
  // LISTGRAM_E2E_AUTO_WEBSERVER=1 locally to spin one up.
  ...(process.env.LISTGRAM_E2E_AUTO_WEBSERVER === "1"
    ? {
        webServer: {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});
