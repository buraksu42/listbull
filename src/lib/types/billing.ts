/**
 * Architect-owned shared types for billing + subscription state
 * (Phase 4.5 schema, Phase 5 enforcement, Phase 6 license).
 *
 * Billing-agent imports these; never declares equivalents in
 * `src/lib/billing/**`. Backend imports for the tier-enforce
 * middleware and the read-side subscription query helper.
 */
import type {
  billingCustomers,
  licenses,
  subscriptions,
} from "@/lib/db/schema";
import type { WorkspaceTier } from "./workspace";

// ─── Subscription ───────────────────────────────────────────────────
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

/**
 * Lifecycle states mirrored from Stripe + Iyzico. Free workspaces
 * have NO `subscriptions` row at all — absence of a row is treated
 * as `tier = 'free'`, `status = 'active'`.
 */
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing";

/**
 * The two payment providers we support. `manual` is reserved for
 * comp / friends-and-family / self-host migration scenarios where a
 * tier is granted without a card on file.
 */
export type BillingProvider = "stripe" | "iyzico" | "manual";

// ─── BillingCustomer ────────────────────────────────────────────────
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type NewBillingCustomer = typeof billingCustomers.$inferInsert;

/**
 * Tier limits. Cached on `workspaces.member_limit` for fast checks;
 * the canonical source is THIS table — Billing-agent's webhook
 * handler refreshes the cached column when tier changes.
 *
 * `workspaceCount` is per-USER (how many workspaces the user can
 * own + create), not per-workspace.
 */
export type TierLimits = {
  tier: WorkspaceTier;
  memberLimit: number;
  workspaceCount: number;
  customRoles: boolean;
  orgApiKey: boolean;
  /** Days kept in `activity_log` before pruning; -1 = unlimited. */
  activityRetentionDays: number;
};

/**
 * Frozen tier table. Source of truth for `checkTier` and the cache
 * refresh in Billing webhooks. Editing this requires a new Architect
 * pass — pricing changes propagate through provider products, not
 * code constants.
 */
export const TIER_LIMITS: Readonly<Record<WorkspaceTier, TierLimits>> =
  Object.freeze({
    free: {
      tier: "free",
      memberLimit: 1,
      workspaceCount: 1,
      customRoles: false,
      orgApiKey: false,
      activityRetentionDays: 30,
    },
    team: {
      tier: "team",
      memberLimit: 5,
      workspaceCount: 1,
      customRoles: false,
      orgApiKey: false,
      activityRetentionDays: 90,
    },
    workspace: {
      tier: "workspace",
      memberLimit: 15,
      workspaceCount: 3,
      customRoles: true,
      orgApiKey: true,
      activityRetentionDays: -1,
    },
  });

// ─── Tier check API (Billing → Backend contract) ────────────────────

/**
 * Discriminated union of actions the tier middleware can gate. Each
 * variant carries the local context the check needs (e.g. current
 * member count for an invite check) so the helper doesn't re-query.
 */
export type TierCheckAction =
  | { type: "create_workspace" }
  | { type: "invite_member"; currentMemberCount: number }
  | { type: "create_list" }
  | { type: "set_org_api_key" }
  | { type: "use_custom_role" };

/**
 * Result envelope. `ok: true` always means the action proceeds; the
 * Phase 4.5 middleware logs and proceeds regardless. Phase 5 flips
 * to active enforcement: `ok: false` returns 402 + JSON body.
 */
export type TierCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "tier_exceeded"
        | "past_due_locked"
        | "workspace_count_exceeded";
      currentTier: WorkspaceTier;
      upgradeTo: "team" | "workspace";
      /** User-facing copy. Caller sets locale; Billing returns string. */
      message: string;
    };

// ─── License (Phase 6 — payload frozen now) ─────────────────────────

/**
 * Signed JWT payload for self-host license keys (Phase 6). Frozen
 * here so Phase 6 implementation is just signing + verification; no
 * new types needed.
 *
 * `workspaces` array allowlists which workspace_ids the license
 * unlocks. For Workspace-tier (3 workspaces), the array carries up
 * to 3 ids assigned at issuance time. For Team-tier (1 workspace),
 * exactly 1 id.
 */
export type LicensePayload = {
  /** Issuer — always 'listbull.net' for SaaS-issued licenses. */
  iss: "listbull.net";
  /** License id (uuid) — used as JWT `sub` and license-table PK. */
  sub: string;
  /** Issued-at unix seconds. */
  iat: number;
  /** Optional expiry unix seconds; absent = perpetual. */
  exp?: number;
  tier: "team" | "workspace";
  /** Locked seat count at issuance; runtime checks against this. */
  seats: number;
  /** Workspace_id allowlist; max 3 for workspace tier, 1 for team. */
  workspaces: string[];
  /** License-bound email — informational for the operator. */
  email: string;
};

/**
 * Result of license verification at request boundary. Phase 6 admin
 * dashboard surfaces `reason` to the operator when check fails.
 */
export type LicenseVerifyResult =
  | { ok: true; payload: LicensePayload }
  | {
      ok: false;
      reason:
        | "missing_key"
        | "invalid_signature"
        | "expired"
        | "revoked"
        | "workspace_not_allowed";
    };

// ─── License row (Phase 6 SaaS-side audit) ───────────────────────────

export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;

/**
 * Public-safe view of an issued license. Used by the admin
 * dashboard list and the self-host operator's email body. The full
 * JWT (`key`) is included exactly once — at issuance time — and
 * never displayed afterward.
 */
export type LicensePublic = {
  id: string;
  tier: "team" | "workspace";
  seats: number;
  issuedToEmail: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  workspaces: string[];
};
