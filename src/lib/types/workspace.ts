/**
 * Architect-owned shared types for the workspace layer (Phase 4.5).
 *
 * Frozen after Phase 4.5 except via Architect-agent invocation. All
 * entity types are derived from the Drizzle schema via $inferSelect /
 * $inferInsert. The string-enum types are app-layer only (no
 * Postgres CHECK constraint — convention from Phase 1).
 *
 * Re-export point: `@/lib/types/index.ts` re-exports from this file
 * so consumers can `import { Workspace } from '@/lib/types'` exactly
 * like they import `User` or `List`.
 */
import type {
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";

// ─── Workspace ──────────────────────────────────────────────────────
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

/**
 * Workspace pricing tiers. Cached on `workspaces.tier`; refreshed by
 * Billing-agent's webhook handler when subscription state changes.
 *
 * Each tier maps to a `member_limit`:
 *   free       → 1
 *   team       → 5
 *   workspace  → 15
 */
export type WorkspaceTier = "free" | "team" | "workspace";

// ─── WorkspaceMember ────────────────────────────────────────────────
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

/**
 * Roles within a workspace.
 *
 * - `owner`: full control, billing, delete workspace, transfer ownership
 * - `admin`: everything owner can do EXCEPT delete + transfer + billing
 *            (Workspace tier only; Team tier has no admin role)
 * - `editor`: mutate items + create lists; cannot mutate members
 * - `viewer`: read-only across workspace (Team+ tier)
 * - `guest`: single-list access only (Team+ tier; gated by
 *            workspace_members + list_members joint membership)
 *
 * Distinct from `ListRole` (`owner` | `editor` | `viewer`) which is
 * scoped to a single list. List roles still exist post-pivot for
 * per-list overrides; workspace role is the broader gate.
 */
export type WorkspaceRole =
  | "owner"
  | "admin"
  | "editor"
  | "viewer"
  | "guest";

/**
 * JSON-safe snapshot of a `workspaces` row. Mirror of `Workspace` with
 * all `Date` fields serialized as ISO 8601 strings.
 *
 * Used as the value type of `activity_log.payload_before` /
 * `payload_after` whenever `entity_type = 'workspace'` (Phase 4.5
 * actions: `workspace_created`, `workspace_renamed`).
 */
export type WorkspaceSnapshot = {
  id: string;
  name: string;
  slug: string;
  tier: WorkspaceTier;
  isPersonal: boolean;
  ownerId: string;
  memberLimit: number;
  /** ISO 8601 string — soft-delete marker. */
  archivedAt: string | null;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
};

/**
 * JSON-safe snapshot of a `workspace_members` row enriched with the
 * joined user info needed for activity-feed rendering without an N+1
 * lookup. Mirrors `MemberSnapshot` (the per-list shape) — same
 * convention so the Frontend renders both with one helper.
 */
export type WorkspaceMemberSnapshot = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  /** ISO 8601 string */
  acceptedAt: string;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
  /** Joined `users` columns — frozen at write-time. */
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

/**
 * View-model used by the workspace switcher dropdown (`switcher.tsx`)
 * and the bot's `list_workspaces` tool output. One row per workspace
 * the user belongs to, with their role + a couple of denormalized
 * counts for the UI.
 *
 * `memberCount` is `workspace_members` size; `listCount` is the
 * count of non-archived `lists` rows where `workspace_id = w.id`.
 * Both computed in a single grouped query at read time.
 */
export type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string;
  tier: WorkspaceTier;
  isPersonal: boolean;
  role: WorkspaceRole;
  memberCount: number;
  listCount: number;
  isActive: boolean;
};

// ─── WorkspaceInvite (Phase 5.5) ─────────────────────────────────────

export type WorkspaceInvite = typeof workspaceInvites.$inferSelect;
export type NewWorkspaceInvite = typeof workspaceInvites.$inferInsert;

/**
 * View-model surfaced by the workspace-invite-accept screen
 * (`/workspace-invites/[token]`). Caller-derived `isExpired` /
 * `isAccepted` so the client doesn't recompute (and disagree
 * with) the same logic.
 */
export type WorkspaceInviteTokenInfo = {
  token: string;
  workspaceId: string;
  workspaceName: string;
  workspaceTier: WorkspaceTier;
  /** Display name of the user who created the invite. */
  invitedByName: string;
  role: WorkspaceRole;
  /** ISO 8601 string */
  expiresAt: string;
  isExpired: boolean;
  isAccepted: boolean;
};
