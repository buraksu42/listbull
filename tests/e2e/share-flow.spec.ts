/**
 * Phase 4 e2e: cross-account share flow.
 *
 * 1. Owner: creates a list, generates a share invite via `share_list`
 *    bot intent OR the share-sheet endpoint.
 * 2. Invitee (separate browser context, separate Telegram user): visits
 *    the invite link, accepts, lands on the shared list, sees the
 *    owner's items.
 *
 * Phase 5 staging activates this once a test bot + two test Telegram
 * users are seeded in the staging DB.
 */
import { test, expect } from "@playwright/test";

import { LIVE } from "./_utils";

test.describe("cross-account share flow", () => {
  test.skip(
    !LIVE,
    "Skipped: requires LISTBULL_E2E_LIVE=1 + two seeded test users (Phase 5 staging gate).",
  );

  test("invitee accepts an invite and sees the owner's list", async ({
    browser,
  }) => {
    // Two contexts = two Telegram users in parallel.
    const ownerCtx = await browser.newContext();
    const inviteeCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    const inviteePage = await inviteeCtx.newPage();

    // Owner creates an invite. In a live run this is wired through
    // `addInitScript` mocking + the share-sheet endpoint.
    // (Implementation deferred to staging — assertion shape here.)
    await ownerPage.goto("/app");
    // Pseudocode: await ownerPage.click('text=Share'); copy invite URL.
    const inviteUrl = "/invites/PLACEHOLDER_TOKEN";

    await inviteePage.goto(inviteUrl);
    // Pseudocode: await inviteePage.click('text=Accept');
    await inviteePage.waitForURL("**/lists/**", { timeout: 10_000 });
    await expect(inviteePage).toHaveURL(/\/lists\//);

    await ownerCtx.close();
    await inviteeCtx.close();
  });
});
