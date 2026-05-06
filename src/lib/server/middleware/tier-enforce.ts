/**
 * Tier-enforcement middleware (Phase 4.5: LOG-ONLY mode).
 *
 * Wraps mutation routes that create resources (workspace, member,
 * list, etc.). Calls Billing-agent's `checkTier(workspaceId, action)`
 * helper, logs the outcome, and — in Phase 4.5 — proceeds regardless.
 *
 * Phase 5 flips behavior via env: when `BILLING_ENFORCE=true`, an
 * `ok: false` result returns 402 + JSON body. Until then, all
 * decisions are observable in logs but never block.
 *
 * Phase 6 also adds license-verify gating; that lives in
 * `license-verify.ts` and runs alongside this middleware (both
 * default DISABLED in Phase 4.5).
 *
 * NOTE: this file ships the SHELL only. Billing-agent's checkTier
 * helper lands at `src/lib/billing/tier-check.ts` in Track B1; this
 * middleware imports from there. Until B1 lands, calls go through a
 * stub that returns `{ ok: true }` for every action — log entries
 * tagged `tier-enforce: stub` so reviewers can spot the placeholder.
 */
import "server-only";

import { checkTier } from "@/lib/billing/tier-check";
import { env } from "@/lib/env";
import type { TierCheckAction } from "@/lib/types";

/**
 * Run the tier check for a given workspace + action. Logs the
 * decision; in Phase 4.5 always returns `{ enforced: false }` so
 * caller proceeds. In Phase 5 (env BILLING_ENFORCE=true), returns
 * `{ enforced: true, response }` when the action is denied — caller
 * surfaces the response as 402.
 */
export type TierEnforceResult =
  | { enforced: false }
  | { enforced: true; reason: string; upgradeTo: "team" | "workspace"; message: string };

export async function enforceTier(
  workspaceId: string,
  action: TierCheckAction,
): Promise<TierEnforceResult> {
  const decision = await checkTier(workspaceId, action);

  // Always log so Phase 5's enforcement flip has historical data to
  // audit before going live.
  if (decision.ok) {
    console.log(
      "[tier-enforce] allow",
      JSON.stringify({ workspaceId, action: action.type }),
    );
  } else {
    console.log(
      "[tier-enforce] would-deny",
      JSON.stringify({
        workspaceId,
        action: action.type,
        reason: decision.reason,
        currentTier: decision.currentTier,
      }),
    );
  }

  // Phase 4.5: never enforce. Phase 5 flips this gate.
  const enforce = env.BILLING_ENFORCE === "true";
  if (!enforce) {
    return { enforced: false };
  }

  if (decision.ok) {
    return { enforced: false };
  }

  return {
    enforced: true,
    reason: decision.reason,
    upgradeTo: decision.upgradeTo,
    message: decision.message,
  };
}
