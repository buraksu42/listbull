/**
 * Tier-check helper. Reads the workspace's subscription state and
 * returns the tier-enforce middleware's decision envelope.
 *
 * Free workspaces have NO `subscriptions` row — absence-of-row is
 * treated as `tier='free'`, `status='active'`. Past-due workspaces
 * past the 7-day grace return `past_due_locked` for ALL actions
 * (read-only mode). Cancelled workspaces revert to free immediately.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import {
  TIER_LIMITS,
  type SubscriptionStatus,
  type TierCheckAction,
  type TierCheckResult,
  type WorkspaceTier,
} from "@/lib/types";

const PAST_DUE_GRACE_DAYS = 7;

/**
 * Resolve the effective tier + status for a workspace. Used by
 * `checkTier` and surfaced via `/api/billing/subscription` for UI
 * banners.
 */
export async function getWorkspaceBillingState(
  workspaceId: string,
): Promise<{
  tier: WorkspaceTier;
  status: SubscriptionStatus;
  pastDueLocked: boolean;
}> {
  const [sub] = await db
    .select({
      tier: subscriptions.tier,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);

  if (!sub) {
    return { tier: "free", status: "active", pastDueLocked: false };
  }

  let pastDueLocked = false;
  if (sub.status === "past_due" && sub.currentPeriodEnd) {
    const graceMs = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = sub.currentPeriodEnd.getTime() + graceMs;
    pastDueLocked = Date.now() > expiresAt;
  }

  return {
    tier: sub.tier as WorkspaceTier,
    status: sub.status as SubscriptionStatus,
    pastDueLocked,
  };
}

/**
 * Check whether the given workspace can perform `action`. Phase 4.5:
 * tier-enforce middleware logs the result; Phase 5 actively rejects
 * `ok: false` with 402.
 *
 * The empty-workspaceId path (used by `create_workspace` from
 * tier-enforce.ts before a workspace exists) checks against the
 * caller's CURRENT workspace count externally — for now the helper
 * grants and tier-enforce handles the caller-side limit.
 */
export async function checkTier(
  workspaceId: string,
  action: TierCheckAction,
): Promise<TierCheckResult> {
  // No workspace context (e.g. createWorkspace pre-insert) — pass
  // through; the route handler counts the user's workspaces and
  // applies the limit.
  if (workspaceId === "") {
    return { ok: true };
  }

  const state = await getWorkspaceBillingState(workspaceId);

  // Past-due lockout overrides everything except read.
  if (state.pastDueLocked) {
    return {
      ok: false,
      reason: "past_due_locked",
      currentTier: state.tier,
      upgradeTo: state.tier === "free" ? "team" : "workspace",
      message:
        "Workspace ödemesi gecikti. Lütfen ödeme yöntemini güncelle.",
    };
  }

  const limits = TIER_LIMITS[state.tier];

  switch (action.type) {
    case "create_list":
      return { ok: true }; // No tier gate on lists in any tier.

    case "create_workspace":
      // Caller's workspace count is checked at the route layer
      // (tier-check doesn't know caller identity). Stub-pass.
      return { ok: true };

    case "invite_member":
      if (action.currentMemberCount >= limits.memberLimit) {
        return {
          ok: false,
          reason: "tier_exceeded",
          currentTier: state.tier,
          upgradeTo: state.tier === "free" ? "team" : "workspace",
          message: `${state.tier} plan limiti: ${limits.memberLimit} üye. Üst plana geç.`,
        };
      }
      return { ok: true };

    case "set_org_api_key":
      if (!limits.orgApiKey) {
        return {
          ok: false,
          reason: "tier_exceeded",
          currentTier: state.tier,
          upgradeTo: "workspace",
          message: "Workspace seviyesinde API key sadece Workspace planında.",
        };
      }
      return { ok: true };

    case "use_custom_role":
      if (!limits.customRoles) {
        return {
          ok: false,
          reason: "tier_exceeded",
          currentTier: state.tier,
          upgradeTo: "workspace",
          message: "Özel roller sadece Workspace planında.",
        };
      }
      return { ok: true };

    default: {
      // Exhaustiveness check.
      const _never: never = action;
      void _never;
      return { ok: true };
    }
  }
}
