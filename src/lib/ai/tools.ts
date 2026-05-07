/**
 * LLM tool registry for listbull Phase 2 + Phase 3.
 *
 * Each tool exports:
 *   - input zod schema  → `<tool>InputSchema`
 *   - output zod schema → `<tool>OutputSchema`
 *   - inferred TS types → `<Tool>Input`, `<Tool>Output`
 *
 * The aggregate `tools` array is the LLM-facing registry consumed by
 * `respond.ts` (this file's neighbor) and re-validated defensively by
 * Backend executors in `src/lib/server/tools/**`. Both sides treat the
 * zod schemas as the immovable contract — see
 * `docs/architecture-pass-phase-2.md` (tools 1-6) and
 * `docs/architecture-pass-phase-3.md` (tools 7-9: share_list,
 * schedule_reminder, assign_item) for the canonical descriptions.
 *
 * Field names are exact per contract; do not improvise. Adding a tool
 * or field requires an Architect-agent invocation, not in-flight edits.
 */
import { z } from "zod";

// ─── shared sub-schemas ─────────────────────────────────────────────

/**
 * JSON-safe item snapshot — mirror of `ItemSnapshot` in
 * `src/lib/types/index.ts`. We re-declare it as a zod schema (rather
 * than importing the type) so that the LLM's output validation uses the
 * same boundary the executors do; the inferred type matches `ItemSnapshot`
 * structurally (`z.infer<typeof itemSnapshotSchema>`).
 *
 * All `Date` fields serialize to ISO 8601 strings — see Inv-5 in the
 * contract for the round-trip stability rule.
 */
export const itemSnapshotSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  isCheckable: z.boolean(),
  isDone: z.boolean(),
  assigneeId: z.string().uuid().nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  reminderSent: z.boolean(),
  /** RFC 5545 RRULE body for recurring reminders, or null for one-shot. */
  recurrenceRule: z.string().nullable().optional(),
  position: z.number().int(),
  createdBy: z.string().uuid(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ItemSnapshotShape = z.infer<typeof itemSnapshotSchema>;

/**
 * Public list info attached to mutation outputs so the LLM can echo
 * back the resolved list ("Süt'ü Inbox'a ekledim") without an extra
 * round-trip.
 */
const listLiteSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  emoji: z.string().nullable(),
});

const listRoleSchema = z.enum(["owner", "editor", "viewer"]);

// ─── 1. create_item ─────────────────────────────────────────────────

export const createItemInputSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "text is required")
      .max(2000, "text must be ≤2000 chars"),
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
    is_checkable: z.boolean().default(true),
  })
  .refine(
    (v) => !(v.is_checkable === false && v.due_at !== undefined),
    {
      message: "notes (is_checkable=false) cannot have due_at",
      path: ["due_at"],
    },
  );

export const createItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  list: listLiteSchema,
  /** Soft warnings from the executor (e.g. due_at_in_past). */
  warnings: z.array(z.string()).optional(),
});

export type CreateItemInput = z.infer<typeof createItemInputSchema>;
export type CreateItemOutput = z.infer<typeof createItemOutputSchema>;

// ─── 2. search_items ────────────────────────────────────────────────

export const searchItemsInputSchema = z.object({
  // Empty query is allowed — pair it with `list_id`/`list_name` to dump
  // every item in a list (the user just asked "ev işlerinde ne var?").
  // With an empty query AND no list scope, returns the most recent items
  // across all writable lists up to `limit`.
  query: z.string().trim().max(500, "query must be ≤500 chars").default(""),
  list_id: z.string().uuid().optional(),
  list_name: z.string().min(1).max(200).optional(),
  include_done: z.boolean().default(false),
  include_archived: z.boolean().default(false),
  /**
   * Restrict to items with an active (future) reminder. `true` = only
   * items where `due_at IS NOT NULL AND due_at > now() AND
   * reminder_sent = false`. `false` (default) = no filter on due_at.
   * Use this to answer "hangi hatırlatıcılar var?" / "what reminders
   * do I have?" — pair with empty `query` and no list scope to get
   * a workspace-wide active-reminders list.
   */
  has_reminder: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
});

export const searchItemsOutputSchema = z.object({
  results: z.array(
    z.object({
      item: itemSnapshotSchema,
      list: listLiteSchema,
      score: z.number().min(0).max(1),
    }),
  ),
  total_matched: z.number().int().nonnegative(),
  searched_lists: z.array(
    z.object({ id: z.string().uuid(), name: z.string() }),
  ),
});

export type SearchItemsInput = z.infer<typeof searchItemsInputSchema>;
export type SearchItemsOutput = z.infer<typeof searchItemsOutputSchema>;

// ─── 3. update_item ─────────────────────────────────────────────────

/**
 * `due_at: null` clears the reminder; omitting `due_at` leaves it
 * untouched. zod's nullable() permits explicit null, optional() permits
 * absence — combining them gives both.
 */
export const updateItemInputSchema = z
  .object({
    item_id: z.string().uuid(),
    text: z.string().trim().min(1).max(2000).optional(),
    due_at: z.string().datetime({ offset: true }).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    /**
     * Move the item to a different list (same workspace). Caller passes
     * the target list's UUID; executor validates membership + write
     * access on the destination. Activity row is written to the
     * destination list with action `item_moved`.
     */
    target_list_id: z.string().uuid().optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.due_at !== undefined ||
      v.position !== undefined ||
      v.target_list_id !== undefined,
    {
      message:
        "at least one of text, due_at, position, or target_list_id must be supplied",
    },
  );

export const updateItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  changes: z.array(z.enum(["text", "due_at", "position", "list_id"])),
  /** Soft warnings (e.g. due_at_in_past). */
  warnings: z.array(z.string()).optional(),
});

export type UpdateItemInput = z.infer<typeof updateItemInputSchema>;
export type UpdateItemOutput = z.infer<typeof updateItemOutputSchema>;

// ─── 4. complete_item ───────────────────────────────────────────────

export const completeItemInputSchema = z.object({
  item_id: z.string().uuid(),
  is_done: z.boolean(),
});

export const completeItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  was_done: z.boolean(),
});

export type CompleteItemInput = z.infer<typeof completeItemInputSchema>;
export type CompleteItemOutput = z.infer<typeof completeItemOutputSchema>;

// ─── 5. delete_item ─────────────────────────────────────────────────

export const deleteItemInputSchema = z.object({
  item_id: z.string().uuid(),
});

export const deleteItemOutputSchema = z.object({
  /** Item as it existed pre-archive. Lets the LLM offer "undo" copy. */
  item: itemSnapshotSchema,
});

export type DeleteItemInput = z.infer<typeof deleteItemInputSchema>;
export type DeleteItemOutput = z.infer<typeof deleteItemOutputSchema>;

// ─── 6. list_lists ──────────────────────────────────────────────────

export const listListsInputSchema = z.object({
  include_archived: z.boolean().default(false),
});

export const listListsOutputSchema = z.object({
  lists: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      emoji: z.string().nullable(),
      is_inbox: z.boolean(),
      role: listRoleSchema,
      item_count: z.number().int().nonnegative(),
      open_count: z.number().int().nonnegative(),
    }),
  ),
});

export type ListListsInput = z.infer<typeof listListsInputSchema>;
export type ListListsOutput = z.infer<typeof listListsOutputSchema>;

// ─── 6b. create_list (post-Phase-5 architectural gap fix) ─────────
//
// Originally not in the Phase-1..4 tool inventory: lists were created
// only via /start (Inbox) — no LLM-mediated path. Surfaced when users
// asked the bot "yeni alışveriş listesi yap" and it had no tool to
// invoke. Adds owner-only list creation; auto-creates a `list_members`
// row (Inv-2) and an `activity_log` `list_created` entry (Inv-1).

export const createListInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "List name is required")
    .max(120, "List name must be ≤120 chars"),
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .nullable()
    .optional(),
});

export const createListOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
  }),
});

export type CreateListInput = z.infer<typeof createListInputSchema>;
export type CreateListOutput = z.infer<typeof createListOutputSchema>;

// ─── 6c. update_list — rename / re-emoji a list (owner-only) ──────
//
// Pairs with create_list. Inbox renaming is allowed (display string)
// but is_inbox stays true. Editors and viewers cannot mutate the list
// shell — they're scoped to items.

export const updateListInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    emoji: z.string().trim().min(1).max(8).nullable().optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  })
  .refine((v) => v.name !== undefined || v.emoji !== undefined, {
    message: "At least one of `name` or `emoji` must be supplied",
  });

export const updateListOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
  }),
  changes: z.array(z.enum(["name", "emoji"])),
});

export type UpdateListInput = z.infer<typeof updateListInputSchema>;
export type UpdateListOutput = z.infer<typeof updateListOutputSchema>;

// ─── 6d. delete_list — soft-delete (trash) with confirm-on-non-empty ─
//
// Inbox cannot be deleted. Non-empty lists require explicit `confirm: true`
// — first call returns `requires_confirm` with item count, LLM relays the
// warning to the user, user confirms, second call sets archived_at.
// Items inside stay intact (also soft-deletable independently); restore
// puts everything back via restore_list.

export const deleteListInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(120).optional(),
    confirm: z.boolean().default(false),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  });

export const deleteListOutputSchema = z.object({
  list_id: z.string().uuid(),
  active_item_count: z.number().int().nonnegative().optional(),
  requires_confirm: z.boolean().optional(),
});

export type DeleteListInput = z.infer<typeof deleteListInputSchema>;
export type DeleteListOutput = z.infer<typeof deleteListOutputSchema>;

// ─── 6e. restore_list — undo soft-delete (30-day trash window) ──────

export const restoreListInputSchema = z.object({
  list_id: z.string().uuid(),
});

export const restoreListOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
  }),
});

export type RestoreListInput = z.infer<typeof restoreListInputSchema>;
export type RestoreListOutput = z.infer<typeof restoreListOutputSchema>;

// ─── 6f. switch_workspace (Phase 4.5) ─────────────────────────────────
//
// Set the user's active workspace. Subsequent tool calls in the same
// turn — and the user's default workspace until they switch again —
// operate against this workspace.

export const switchWorkspaceInputSchema = z
  .object({
    workspace_id: z.string().uuid().optional(),
    workspace_name: z.string().min(1).max(120).optional(),
  })
  .refine(
    (v) => v.workspace_id !== undefined || v.workspace_name !== undefined,
    { message: "Either workspace_id or workspace_name is required" },
  );

export const switchWorkspaceOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    tier: z.enum(["free", "team", "workspace"]),
    role: z.enum(["owner", "admin", "editor", "viewer", "guest"]),
  }),
});

export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceInputSchema>;
export type SwitchWorkspaceOutput = z.infer<typeof switchWorkspaceOutputSchema>;

// ─── 6g. list_workspaces (Phase 4.5) ──────────────────────────────────
//
// Read-only enumeration of every workspace the user belongs to —
// powers the workspace switcher dropdown in Mini App + the bot's
// "hangi workspace'lerim var" answer.

export const listWorkspacesInputSchema = z.object({});

export const listWorkspacesOutputSchema = z.object({
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      tier: z.enum(["free", "team", "workspace"]),
      is_personal: z.boolean(),
      role: z.enum(["owner", "admin", "editor", "viewer", "guest"]),
      member_count: z.number().int().nonnegative(),
      list_count: z.number().int().nonnegative(),
      is_active: z.boolean(),
    }),
  ),
});

export type ListWorkspacesInput = z.infer<typeof listWorkspacesInputSchema>;
export type ListWorkspacesOutput = z.infer<typeof listWorkspacesOutputSchema>;

// ─── 6h. update_workspace (Phase 4.5) ─────────────────────────────────
//
// Owner-only rename. The slug auto-regenerates from the new name; the
// `tier` field stays read-only (changing tier requires a billing
// event, owned by Billing-agent).

export const updateWorkspaceInputSchema = z
  .object({
    workspace_id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
  })
  .refine((v) => v.name !== undefined, {
    message: "name is required",
  });

export const updateWorkspaceOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  }),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;
export type UpdateWorkspaceOutput = z.infer<typeof updateWorkspaceOutputSchema>;

// ─── 6i. invite_to_workspace (Phase 4.5) ──────────────────────────────
//
// Owner / admin invite a user to the active workspace. Phase 4.5
// schema-only for shared workspaces (Team/Workspace tier) — Free
// tier has only the Personal Workspace, so this tool returns
// `tier_exceeded` log entries (and Phase 5 enforces). Mirrors
// `share_list`'s deeplink + DM pattern.

export const inviteToWorkspaceInputSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "username is required")
    .max(33, "username must be ≤32 chars (plus optional leading @)"),
  role: z.enum(["admin", "editor", "viewer", "guest"]).default("editor"),
});

export const inviteToWorkspaceOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
  }),
  invitedUsername: z.string(),
  role: z.enum(["admin", "editor", "viewer", "guest"]),
  /**
   * Phase 4.5 ships the schema; the actual invite-token + DM flow
   * lands when shared workspaces become creatable in Phase 5. Until
   * then this returns `pending_phase_5` for Free-tier callers; tier
   * middleware logs the attempt.
   */
  status: z.enum(["invite_sent", "already_member", "pending_phase_5"]),
  warnings: z.array(z.string()).optional(),
});

export type InviteToWorkspaceInput = z.infer<
  typeof inviteToWorkspaceInputSchema
>;
export type InviteToWorkspaceOutput = z.infer<
  typeof inviteToWorkspaceOutputSchema
>;

// ─── 6j. remove_workspace_member (Phase 4.5) ──────────────────────────

export const removeWorkspaceMemberInputSchema = z
  .object({
    username: z.string().trim().min(1).max(64).optional(),
    user_id: z.string().uuid().optional(),
  })
  .refine((v) => v.username !== undefined || v.user_id !== undefined, {
    message: "Either username or user_id is required",
  });

export const removeWorkspaceMemberOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  removed_user_id: z.string().uuid(),
});

export type RemoveWorkspaceMemberInput = z.infer<
  typeof removeWorkspaceMemberInputSchema
>;
export type RemoveWorkspaceMemberOutput = z.infer<
  typeof removeWorkspaceMemberOutputSchema
>;

// ─── 6k. set_item_attributes (Phase 4.5) ──────────────────────────────
//
// Set status / priority / tags on an existing item. Replaces ad-hoc
// "blokladım", "yüksek öncelik" phrasings the LLM otherwise tries to
// embed in item text. Tags are workspace-scoped vocabulary; the
// executor enforces the 20-unique-tags-per-workspace cap.

export const setItemAttributesInputSchema = z
  .object({
    item_id: z.string().uuid(),
    status: z
      .enum(["open", "in_progress", "blocked", "done"])
      .optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined,
    {
      message:
        "At least one of status, priority, or tags must be supplied",
    },
  );

export const setItemAttributesOutputSchema = z.object({
  item: itemSnapshotSchema,
  status: z.enum(["open", "in_progress", "blocked", "done"]),
  priority: z.enum(["low", "normal", "high"]),
  tags: z.array(z.string()),
  changes: z.array(z.enum(["status", "priority", "tags"])),
  warnings: z.array(z.string()).optional(),
});

export type SetItemAttributesInput = z.infer<
  typeof setItemAttributesInputSchema
>;
export type SetItemAttributesOutput = z.infer<
  typeof setItemAttributesOutputSchema
>;

// ─── 7a. list_members — read-only enumeration of a list's members ─────

export const listMembersInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(120).optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  });

export const listMembersOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
  }),
  members: z.array(
    z.object({
      user_id: z.string().uuid(),
      telegram_username: z.string().nullable(),
      telegram_first_name: z.string(),
      role: z.enum(["owner", "editor", "viewer"]),
      joined_at: z.string(),
    }),
  ),
});

export type ListMembersInput = z.infer<typeof listMembersInputSchema>;
export type ListMembersOutput = z.infer<typeof listMembersOutputSchema>;

// ─── 7a2. update_settings — let the user change their preferences via chat ─
//
// Mirrors the PATCH /api/settings shape but exposed as a bot tool so
// users without easy Mini App access can fix their timezone/locale/etc.
// from the chat. BYOK key updates intentionally NOT supported here —
// pasting an API key into a Telegram chat persists in conversation
// history and is a security smell. Direct users to the Mini App
// settings page for that.

export const updateSettingsInputSchema = z
  .object({
    locale: z.enum(["tr", "en"]).optional(),
    timezone: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_+\-/]+$/, {
        message: "timezone must be an IANA name like Europe/Istanbul",
      })
      .optional(),
    llm_model: z
      .enum([
        "anthropic/claude-haiku-4.5",
        "anthropic/claude-sonnet-4",
        "anthropic/claude-opus-4.7",
        "google/gemini-2.5-flash",
        "google/gemini-2.5-pro",
        "openai/gpt-4o-mini",
      ])
      .optional(),
    notifications_enabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message:
      "At least one of locale, timezone, llm_model, or notifications_enabled must be supplied",
  });

export const updateSettingsOutputSchema = z.object({
  locale: z.enum(["tr", "en"]),
  timezone: z.string(),
  llm_model: z.string(),
  notifications_enabled: z.boolean(),
  changes: z.array(
    z.enum(["locale", "timezone", "llm_model", "notifications_enabled"]),
  ),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;
export type UpdateSettingsOutput = z.infer<typeof updateSettingsOutputSchema>;

// ─── 7b. remove_member — kick a member off a shared list (owner-only) ─

export const removeMemberInputSchema = z
  .object({
    list_id: z.string().uuid(),
    username: z.string().trim().min(1).max(64).optional(),
    user_id: z.string().uuid().optional(),
  })
  .refine((v) => v.username !== undefined || v.user_id !== undefined, {
    message: "Either username or user_id is required",
  });

export const removeMemberOutputSchema = z.object({
  list_id: z.string().uuid(),
  removed_user_id: z.string().uuid(),
});

export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>;
export type RemoveMemberOutput = z.infer<typeof removeMemberOutputSchema>;

// ─── 7c. update_member_role — change role for a current member (owner-only) ─

export const updateMemberRoleInputSchema = z
  .object({
    list_id: z.string().uuid(),
    username: z.string().trim().min(1).max(64).optional(),
    user_id: z.string().uuid().optional(),
    role: z.enum(["editor", "viewer"]),
  })
  .refine((v) => v.username !== undefined || v.user_id !== undefined, {
    message: "Either username or user_id is required",
  });

export const updateMemberRoleOutputSchema = z.object({
  list_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(["owner", "editor", "viewer"]),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>;
export type UpdateMemberRoleOutput = z.infer<
  typeof updateMemberRoleOutputSchema
>;

// ─── 7. share_list (Phase 3) ────────────────────────────────────────
//
// Field names match `docs/architecture-pass-phase-3.md` § "share_list"
// exactly. Caller passes `username` (with or without leading @ — the
// executor lowers + strips). At least one of `list_id` or `list_name`
// must be present; Inbox fallback does NOT apply (sharing your Inbox
// is nonsensical, and the executor returns `cannot_share_inbox`).

export const shareListInputSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, "username is required")
      .max(33, "username must be ≤32 chars (plus optional leading @)"),
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
    role: z.enum(["editor", "viewer"]).default("editor"),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "one of list_id or list_name must be supplied",
    path: ["list_id"],
  });

export const shareListOutputSchema = z.object({
  invite: z.object({
    token: z.string(),
    /** ISO 8601, default now + 7 days. */
    expiresAt: z.string().datetime({ offset: true }),
    /** e.g. "https://t.me/<bot>?startapp=invite_<token>". */
    deeplink: z.string(),
    role: z.enum(["editor", "viewer"]),
  }),
  list: listLiteSchema,
  /** Lowered, leading-@ stripped — what was actually stored. */
  invitedUsername: z.string(),
  /**
   * True when the invitee is already a member of this list. Phrase
   * the reply as "X zaten üye"; do NOT include the deeplink even
   * though `invite` is populated for shape consistency.
   */
  alreadyMember: z.boolean().optional(),
  /**
   * Soft warnings from the executor (e.g. `invitee_dm_failed` when the
   * invitee hasn't started the bot yet — the invite row is still valid
   * and the user can paste the deeplink manually). Mirrors
   * `createItemOutputSchema` and `scheduleReminderOutputSchema`.
   * Added per Architect's Phase 4 contract § P2-1.
   */
  warnings: z.array(z.string()).optional(),
});

export type ShareListInput = z.infer<typeof shareListInputSchema>;
export type ShareListOutput = z.infer<typeof shareListOutputSchema>;

// ─── 7d. cancel_invite — revoke a PENDING invite (owner-only) ─────────
//
// Closes the gap surfaced when users said "ayselin davetini iptal et":
// share_list creates an invite row, but until cancel_invite there was
// no LLM-mediated way to delete it. Owner-only. Operates only on
// PENDING (non-accepted) invites — once accepted, the user is a list
// member and the LLM should call `remove_member` instead.
//
// Identification: (list_id|list_name) + username. The username is
// lower-cased + leading-@ stripped before lookup so "Aysel", "@aysel",
// "aysel" all match the stored row. If a stale ACCEPTED row exists
// the executor returns `invite_already_accepted` so the LLM can pivot
// to remove_member.

export const cancelInviteInputSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, "username is required")
      .max(33, "username must be ≤32 chars (plus optional leading @)"),
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "one of list_id or list_name must be supplied",
    path: ["list_id"],
  });

export const cancelInviteOutputSchema = z.object({
  list: listLiteSchema,
  /** Lowered, leading-@ stripped username whose invite was canceled. */
  invitedUsername: z.string(),
  /** Echoed for symmetry with share_list output; never log/surface. */
  cancelledInviteId: z.string().uuid(),
});

export type CancelInviteInput = z.infer<typeof cancelInviteInputSchema>;
export type CancelInviteOutput = z.infer<typeof cancelInviteOutputSchema>;

// ─── 8. schedule_reminder (Phase 3) ─────────────────────────────────
//
// Thin semantic wrapper over `update_item` for the due_at column.
// Per Architect's contract (§ schedule_reminder), the input is just
// `item_id` + `due_at` — no list/text resolution path. If the user's
// reference is fuzzy ("Sapiens'i pazartesi 09:00'da hatırlatsın"),
// the LLM is expected to call `search_items` first to obtain the
// `item_id`, then call this tool. `due_at: null` (explicit) clears
// the reminder; omission → `invalid_input`.

export const scheduleReminderInputSchema = z.object({
  item_id: z.string().uuid(),
  /**
   * ISO 8601 with offset to set; explicit null to clear. Required
   * (omission → `invalid_input`) — the difference between "set" and
   * "clear" must be explicit so we don't conflate them.
   */
  due_at: z.string().datetime({ offset: true }).nullable(),
  /**
   * Optional RFC 5545 RRULE body (no `RRULE:` prefix, no DTSTART) for
   * recurring reminders. Pass null or omit for one-shot. Pass null
   * explicitly alongside a non-null `due_at` to convert a recurring
   * reminder back to one-shot. Times in the rule are interpreted in
   * UTC — convert local times accordingly before emitting.
   *
   * Examples:
   *   - "every Wednesday at 21:00 Europe/Istanbul" (no DST):
   *       FREQ=WEEKLY;BYDAY=WE;BYHOUR=18;BYMINUTE=0
   *   - "every weekday at 09:00 UTC":
   *       FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
   *   - "every month on the 1st at 12:00 UTC":
   *       FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=12;BYMINUTE=0
   */
  recurrence_rule: z.string().trim().min(1).max(500).nullable().optional(),
});

export const scheduleReminderOutputSchema = z.object({
  /** Post-update snapshot; reminder_sent reset to false on set. */
  item: itemSnapshotSchema,
  /** True when the call cleared a previously-set due_at. */
  cleared: z.boolean(),
  /** Soft warnings (e.g. due_at_in_past). */
  warnings: z.array(z.string()).optional(),
});

export type ScheduleReminderInput = z.infer<typeof scheduleReminderInputSchema>;
export type ScheduleReminderOutput = z.infer<typeof scheduleReminderOutputSchema>;

// ─── 9. assign_item (Phase 3) ───────────────────────────────────────
//
// Field name `assignee_username` matches Architect's contract (§
// assign_item) — it accepts BOTH a Telegram handle ("@ali", "ali")
// and a bare first-name token ("Ali"). The executor — not the LLM —
// resolves: lower(telegram_username) exact match, falling back to
// lower(telegram_first_name) prefix match, scoped to the item's
// list members. Pass `null` (explicit) to unassign.

export const assignItemInputSchema = z.object({
  item_id: z.string().uuid(),
  /**
   * Username (with or without leading @) OR bare first-name token.
   * Executor resolves against the list's members only. `null`
   * unassigns. Required (omission → `invalid_input`) — see
   * `schedule_reminder` for the "set vs clear must be explicit" rationale.
   */
  assignee_username: z.string().trim().min(1).max(64).nullable(),
});

export const assignItemOutputSchema = z.object({
  /** Post-update snapshot. */
  item: itemSnapshotSchema,
  /** Resolved assignee user; null when unassigned. */
  assignee: z
    .object({
      id: z.string().uuid(),
      telegramUsername: z.string().nullable(),
      telegramFirstName: z.string(),
    })
    .nullable(),
  /** Previous assignee_id, or null if previously unassigned. */
  previousAssigneeId: z.string().uuid().nullable(),
});

export type AssignItemInput = z.infer<typeof assignItemInputSchema>;
export type AssignItemOutput = z.infer<typeof assignItemOutputSchema>;

// ─── tool registry (LLM-facing) ─────────────────────────────────────

/**
 * Single tool definition the orchestrator consumes. Mirrors what
 * Anthropic / OpenRouter expects (`name`, `description`, `input_schema`)
 * but we keep zod here and convert to JSON Schema at the call site.
 */
export type ToolDefinition = {
  name: ToolName;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
};

export const TOOL_NAMES = [
  "create_item",
  "search_items",
  "update_item",
  "complete_item",
  "delete_item",
  "list_lists",
  "create_list",
  "update_list",
  "delete_list",
  "restore_list",
  "share_list",
  "cancel_invite",
  "list_members",
  "remove_member",
  "update_member_role",
  "update_settings",
  "schedule_reminder",
  "assign_item",
  // Phase 4.5: workspace + item-discipline tools
  "switch_workspace",
  "list_workspaces",
  "update_workspace",
  "invite_to_workspace",
  "remove_workspace_member",
  "set_item_attributes",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * LLM-facing descriptions. Action-oriented; encode behaviors that the
 * model must know (defensive list resolution, soft delete, explicit
 * is_done) so it emits inputs the executors can satisfy.
 */
export const tools: readonly ToolDefinition[] = [
  {
    name: "create_item",
    description:
      "Create a new item (todo or note) in one of the user's lists. " +
      "Pass `list_id` (UUID) when known, or `list_name` to resolve by " +
      "human-readable name; if both are absent OR the name doesn't " +
      "match exactly one list, the item lands in the user's Inbox. " +
      "`is_checkable` defaults to true (todo); set false for notes — " +
      "notes can't have a `due_at` and can't be completed. `due_at` " +
      "must be ISO 8601 in the future; past times are silently dropped " +
      "with a warning. Use this for any 'add', 'note', 'remind me' " +
      "intent.",
    inputSchema: createItemInputSchema,
    outputSchema: createItemOutputSchema,
  },
  {
    name: "search_items",
    description:
      "Search or enumerate the user's items. With a non-empty `query`, " +
      "performs ILIKE substring match on item text (case-insensitive). " +
      "With EMPTY query (or query omitted), returns ALL items in scope " +
      "— use this when the user asks 'ev işlerinde ne var?' / 'what's " +
      "in my list?' — pair the empty query with `list_name` (or " +
      "`list_id`) to scope to a single list. Without any list scope, " +
      "searches across every list the user is a member of. By default " +
      "completed and archived items are excluded; pass `include_done` " +
      "or `include_archived: true` to broaden. Pass `has_reminder: true` " +
      "to restrict to items with an ACTIVE FUTURE reminder (due_at not " +
      "null, in the future, not yet sent) — use this for 'hangi " +
      "hatırlatıcılar var?' / 'what reminders do I have?'. Returns " +
      "items with their list context plus the list of scanned lists.",
    inputSchema: searchItemsInputSchema,
    outputSchema: searchItemsOutputSchema,
  },
  {
    name: "update_item",
    description:
      "Edit an existing item's text, due date, position, or move it " +
      "to a different list (in the same workspace). At least one of " +
      "`text`, `due_at`, `position`, or `target_list_id` must be " +
      "supplied. Pass `target_list_id: <list-uuid>` to MOVE the item " +
      "(history + completion state preserved — prefer this over " +
      "delete+recreate). Pass `due_at: null` (explicit) to CLEAR a " +
      "reminder; omitting `due_at` leaves it unchanged. Past `due_at` " +
      "values are silently dropped with a warning. `changes` in the " +
      "output names the fields that actually changed — use it to " +
      "phrase a precise confirmation.",
    inputSchema: updateItemInputSchema,
    outputSchema: updateItemOutputSchema,
  },
  {
    name: "complete_item",
    description:
      "Mark an item done (`is_done: true`) or undone (`is_done: false`). " +
      "Decide explicitly which state the user wants before calling — " +
      "this tool sets state, it does not toggle. If the item is " +
      "already in the requested state, the call is a no-op and " +
      "`was_done` reflects the prior state; phrase the reply as " +
      "'already done' rather than a redundant confirmation. Notes " +
      "(items with `is_checkable=false`) cannot be completed.",
    inputSchema: completeItemInputSchema,
    outputSchema: completeItemOutputSchema,
  },
  {
    name: "delete_item",
    description:
      "Soft-delete an item (sets archived_at; the item is recoverable " +
      "for 30 days via the audit log). Returns the item snapshot as it " +
      "existed pre-archive — use it to offer 'undo' phrasing. Already-" +
      "archived items return not_found; you cannot double-delete.",
    inputSchema: deleteItemInputSchema,
    outputSchema: deleteItemOutputSchema,
  },
  {
    name: "list_lists",
    description:
      "Enumerate every list the user is a member of, with role and " +
      "open/total item counts. Inbox is always present and appears " +
      "first. Use this when you need to disambiguate an ambiguous " +
      "list reference, or when the user asks 'hangi listelerim var'. " +
      "Read-only; no mutations.",
    inputSchema: listListsInputSchema,
    outputSchema: listListsOutputSchema,
  },
  {
    name: "create_list",
    description:
      "Create a new list owned by the calling user. Pass `name` (1-120 chars; " +
      "deduplication is the user's responsibility — multiple lists with the " +
      "same name are allowed). `emoji` is optional (single emoji char). The " +
      "Inbox list is auto-created on /start; do NOT call this for Inbox. " +
      "Use when the user asks 'yeni alışveriş listesi yap' / 'create a " +
      "shopping list' / similar net-new list intent. After success, items " +
      "added in the same conversational turn should target the new list_id.",
    inputSchema: createListInputSchema,
    outputSchema: createListOutputSchema,
  },
  {
    name: "update_list",
    description:
      "Rename a list and/or change its emoji. OWNER-ONLY: editors and " +
      "viewers can't mutate the list shell. Pass `list_id` (preferred) " +
      "or `list_name` to identify the target. Provide `name` (1-120) " +
      "and/or `emoji` (1-8 chars; pass null to remove). At least one " +
      "must be supplied. Inbox can be renamed and re-emoji'd freely. " +
      "Output `changes` enumerates the fields that actually changed — " +
      "use it for a precise confirmation reply.",
    inputSchema: updateListInputSchema,
    outputSchema: updateListOutputSchema,
  },
  {
    name: "delete_list",
    description:
      "Soft-delete (move-to-trash) a list. OWNER-ONLY. Inbox cannot be " +
      "deleted. Non-empty lists require an explicit confirmation: " +
      "the FIRST call returns `requires_confirm: true` with " +
      "`active_item_count` — relay this to the user ('Bu listede 5 " +
      "aktif madde var, silmek istediğinden emin misin?'). On user " +
      "confirmation, call again with `confirm: true`. Empty lists " +
      "delete immediately on first call. Items inside aren't deleted; " +
      "the list is simply hidden. Restore within 30 days via restore_list.",
    inputSchema: deleteListInputSchema,
    outputSchema: deleteListOutputSchema,
  },
  {
    name: "restore_list",
    description:
      "Undo a soft-deleted list (sets archived_at back to null). " +
      "OWNER-ONLY. Pass `list_id` of a previously deleted list. Items " +
      "inside the list become visible again exactly as they were at " +
      "delete time — nothing in the items table is mutated by " +
      "delete_list, only the parent list's archived_at flag.",
    inputSchema: restoreListInputSchema,
    outputSchema: restoreListOutputSchema,
  },
  {
    name: "share_list",
    description:
      "Invite another Telegram user to one of the OWNER's lists as " +
      "an editor (default) or viewer — the bot DMs the invitee a " +
      "deeplink that opens the Mini App accept screen. Pass " +
      "`username` (with or without leading @ — case is normalized). " +
      "Pass `list_id` when known; else `list_name` (resolved with the " +
      "same rules as `create_item` EXCEPT no Inbox fallback — sharing " +
      "the Inbox is rejected with `cannot_share_inbox`). Caller must " +
      "be the list `owner` (editors and viewers cannot share — " +
      "`forbidden`). The invitee must have started the bot at least " +
      "once for the DM to land; if not, the executor returns warning " +
      "`invitee_dm_failed` but the invite row is still valid (user " +
      "can paste the deeplink manually). If the user is already a " +
      "member, the tool returns `alreadyMember: true` with NO new " +
      "invite — phrase the reply as 'X zaten üye' and skip the " +
      "deeplink. Common error envelopes: `forbidden` (caller not " +
      "owner), `invalid_input` (self-invite or `cannot_share_inbox`), " +
      "`ambiguous_list`, `not_found`. For multi-list ambiguity " +
      "(\"share my list\" with multiple lists), ask the user which " +
      "list before calling.",
    inputSchema: shareListInputSchema,
    outputSchema: shareListOutputSchema,
  },
  {
    name: "cancel_invite",
    description:
      "Revoke a PENDING invite that share_list created earlier (OWNER-" +
      "ONLY). Identifies the invite by `list_id` (or `list_name`) plus " +
      "`username` (Telegram handle, with or without leading @ — case " +
      "normalized). Use this when the user says 'Aysel'in davetini iptal " +
      "et' / 'cancel the invite I sent to @ali' / 'davet linkini geri al'. " +
      "Only pending (non-accepted) invites can be canceled. If the " +
      "invitee has ALREADY ACCEPTED, the executor returns " +
      "`invite_already_accepted` — pivot to `remove_member` instead and " +
      "tell the user 'Aysel daveti zaten kabul etmişti, listeden çıkardım'. " +
      "Common error envelopes: `forbidden` (caller not owner), " +
      "`not_found` (no pending invite), `ambiguous_list`, `invite_already_accepted`.",
    inputSchema: cancelInviteInputSchema,
    outputSchema: cancelInviteOutputSchema,
  },
  {
    name: "list_members",
    description:
      "READ-ONLY enumeration of a list's members. Any role (owner / " +
      "editor / viewer) can call this; useful when the user asks " +
      "'kim bu listede?' / 'who's in my list?' / 'üyeleri göster'. " +
      "Pass `list_id` (preferred) or `list_name`. Returns the list " +
      "shell + an array of { user_id, telegram_username, " +
      "telegram_first_name, role, joined_at }. Use the response to " +
      "phrase a friendly summary like 'Listede sen + Ali (editör) " +
      "var'. Inbox membership is always just the owner.",
    inputSchema: listMembersInputSchema,
    outputSchema: listMembersOutputSchema,
  },
  {
    name: "remove_member",
    description:
      "Remove a current member from a shared list (OWNER-ONLY). Pass " +
      "`list_id` plus either `username` (Telegram, with or without @ — " +
      "case normalized) or `user_id` (UUID, for unambiguous removal). " +
      "The owner cannot remove themselves (rejected with " +
      "`cannot_remove_owner` — to delete the list, use `delete_list`). " +
      "Side effects: list_member row deleted; any items in that list " +
      "assigned to the removed user have `assignee_id` cleared (Inv-12) " +
      "with corresponding `item_unassigned` activity log rows. The " +
      "removed user can no longer see or edit the list immediately.",
    inputSchema: removeMemberInputSchema,
    outputSchema: removeMemberOutputSchema,
  },
  {
    name: "update_member_role",
    description:
      "Change an existing member's role on a shared list (OWNER-ONLY). " +
      "Pass `list_id`, the target via `username` or `user_id`, and the " +
      "new `role` ('editor' or 'viewer' — owner role isn't transferable " +
      "via this tool). The owner cannot demote themselves. " +
      "`editor` can mutate items; `viewer` is read-only. Use this to " +
      "reduce a member's permissions ('Ali'yi sadece okuyabilir yap') " +
      "or restore writes ('Ali'ye düzenleme izni ver').",
    inputSchema: updateMemberRoleInputSchema,
    outputSchema: updateMemberRoleOutputSchema,
  },
  {
    name: "update_settings",
    description:
      "Change the calling user's preferences. Supported fields: " +
      "`locale` ('tr' | 'en'), `timezone` (IANA name like 'Europe/" +
      "Istanbul' / 'America/New_York'), `llm_model` (preset list), " +
      "`notifications_enabled` (boolean — when false, reminder DMs are " +
      "suppressed). At least one must be supplied. Use this when the " +
      "user says 'saat dilimi İstanbul olsun' / 'use Istanbul time' / " +
      "'set my timezone' / 'change to English' / 'turn off reminders'. " +
      "BYOK API key cannot be set this way (security: chat history " +
      "would persist the secret) — direct the user to the Mini App " +
      "settings page for that. Output `changes` lists fields that " +
      "actually changed; use it to phrase a precise confirmation.",
    inputSchema: updateSettingsInputSchema,
    outputSchema: updateSettingsOutputSchema,
  },
  {
    name: "schedule_reminder",
    description:
      "Set, change, or clear the due_at on an EXISTING item — does " +
      "NOT create new items. Pass `item_id` (resolve via `search_items` " +
      "first if you only have item text) plus either `due_at` (ISO " +
      "8601 with timezone offset, in the future) to schedule, or " +
      "`due_at: null` (explicit) to clear. The reminder fires as a " +
      "Telegram DM at the given time (UTC-aligned within ±60 s); if " +
      "the item has an assignee, the DM goes to the assignee, " +
      "otherwise to the item's creator. Past `due_at` values are " +
      "silently dropped with warning `due_at_in_past` — surface the " +
      "correction gently and re-prompt the user for a future time, " +
      "do not refuse. Notes (`is_checkable=false`) cannot be " +
      "scheduled (`cannot_schedule_note`). Re-arming an already-fired " +
      "reminder works — the executor resets `reminder_sent` to false. " +
      "For RECURRING reminders pass `recurrence_rule` with an RFC 5545 " +
      "RRULE body (no `RRULE:` prefix). After each fire the cron " +
      "computes the next occurrence and re-arms automatically — DO " +
      "NOT delete+recreate. Times in the rule are interpreted in UTC: " +
      "convert local times before emitting (e.g. `21:00 Europe/Istanbul " +
      "= 18:00 UTC` since Turkey has no DST). Examples — weekly: " +
      "`FREQ=WEEKLY;BYDAY=WE;BYHOUR=18;BYMINUTE=0`; weekday daily: " +
      "`FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0`; monthly " +
      "first-of-month: `FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=12;BYMINUTE=0`. " +
      "Pass `recurrence_rule: null` to convert a recurring reminder " +
      "back to one-shot. If you want to create a fresh item WITH a " +
      "reminder, call `create_item` with `due_at` instead — " +
      "`schedule_reminder` is for already-existing items only. Common " +
      "error envelopes: `not_found`, `forbidden`, `invalid_input` " +
      "(`cannot_schedule_note`, invalid RRULE).",
    inputSchema: scheduleReminderInputSchema,
    outputSchema: scheduleReminderOutputSchema,
  },
  {
    name: "assign_item",
    description:
      "Assign an item to one of the LIST's members, or unassign it. " +
      "Pass `item_id` and either `assignee_username` (with or " +
      "without leading @) to assign — accepts BOTH a Telegram handle " +
      "(\"@ali\") and a bare first-name token (\"ali\", \"Ali\") — or " +
      "`assignee_username: null` (explicit) to unassign. The " +
      "executor resolves the username against the item's list " +
      "members ONLY (exact `lower(telegram_username)`, then prefix " +
      "match on `lower(telegram_first_name)`); pass the raw token " +
      "the user typed and let the executor do the matching. " +
      "Self-assign is allowed. Notes (`is_checkable=false`) CAN be " +
      "assigned. Common error envelopes: `not_a_member` (assignee " +
      "isn't on the list — call `share_list` first to invite, then " +
      "retry once they accept), `assignee_ambiguous` (multiple " +
      "candidates resolve — the error includes a `candidates` list; " +
      "ask the user \"Ali'lerden hangisi?\" with the candidate names " +
      "and re-call with the disambiguating handle), `forbidden`, " +
      "`not_found`, `invalid_input`.",
    inputSchema: assignItemInputSchema,
    outputSchema: assignItemOutputSchema,
  },
  {
    name: "switch_workspace",
    description:
      "Switch the user's active workspace. Subsequent tool calls in " +
      "the same turn — and the user's default workspace until they " +
      "switch again — operate against the new workspace. Pass " +
      "`workspace_id` (preferred) or `workspace_name`. Use when the " +
      "user says 'iş workspace'ine geç' / 'switch to my Personal " +
      "workspace' / 'change to <name>'. Caller must be a member of " +
      "the target workspace. Inbox + Today view are workspace-scoped, " +
      "so a switch changes what `list_lists` and `search_items` " +
      "return.",
    inputSchema: switchWorkspaceInputSchema,
    outputSchema: switchWorkspaceOutputSchema,
  },
  {
    name: "list_workspaces",
    description:
      "Enumerate every workspace the user belongs to, with role and " +
      "member + list counts. Personal Workspace appears first, then " +
      "by created_at. The active workspace has `is_active: true`. " +
      "Use when the user asks 'hangi workspace'lerim var' / 'show " +
      "my workspaces' / when disambiguating an ambiguous workspace " +
      "reference. Read-only; no mutations.",
    inputSchema: listWorkspacesInputSchema,
    outputSchema: listWorkspacesOutputSchema,
  },
  {
    name: "update_workspace",
    description:
      "Rename the active workspace. OWNER-ONLY. Pass `name` (1-120). " +
      "The slug auto-regenerates. Tier change is NOT supported via " +
      "this tool — that flows through billing. Use when the user " +
      "says 'workspace adını <X> yap' / 'rename my workspace to <X>'. " +
      "Personal Workspace can be renamed freely; the `is_personal` " +
      "flag stays.",
    inputSchema: updateWorkspaceInputSchema,
    outputSchema: updateWorkspaceOutputSchema,
  },
  {
    name: "invite_to_workspace",
    description:
      "Invite a Telegram user to the active workspace as `admin` " +
      "(Workspace tier only), `editor` (default), `viewer`, or " +
      "`guest`. OWNER + ADMIN can call. Operates on the user's " +
      "ACTIVE workspace — no list_id / list_name argument; switch " +
      "workspaces first if needed. Pass `username` (with or without " +
      "leading @ — case is normalized).\n\n" +
      "Phase 4.5: Free tier users can call this against their " +
      "Personal Workspace but the executor returns " +
      "`pending_phase_5` since multi-member workspaces require " +
      "Team or Workspace tier; tier middleware logs the attempt. " +
      "Phase 5 enforces tier limits and ships the actual invite-" +
      "token + DM flow.\n\n" +
      "Distinct from `share_list` which adds a member to a SINGLE " +
      "list. Workspace-level invites grant access to ALL lists in " +
      "the workspace via the workspace_members membership.",
    inputSchema: inviteToWorkspaceInputSchema,
    outputSchema: inviteToWorkspaceOutputSchema,
  },
  {
    name: "remove_workspace_member",
    description:
      "Remove a member from the active workspace. OWNER-ONLY. " +
      "Cascades: the removed user loses access to every list in " +
      "the workspace; their list_members rows are deleted; items " +
      "they were assigned to have `assignee_id` cleared. Pass " +
      "`username` (Telegram, with or without @) or `user_id` " +
      "(UUID). Cannot remove the workspace owner (use " +
      "`update_workspace` to transfer ownership first).",
    inputSchema: removeWorkspaceMemberInputSchema,
    outputSchema: removeWorkspaceMemberOutputSchema,
  },
  {
    name: "set_item_attributes",
    description:
      "Set status / priority / tags on an existing item. Use when " +
      "the user says 'X'i blokla' (status='blocked'), 'yüksek " +
      "öncelik' (priority='high'), 'etiket ekle: alışveriş' (add " +
      "tag), 'tamamlandı işaretle' (status='done' — equivalent to " +
      "complete_item with is_done=true).\n\n" +
      "Status values: 'open' | 'in_progress' | 'blocked' | 'done'. " +
      "Setting status='done' also flips is_done=true (dual-write " +
      "for backward compat). Priority: 'low' | 'normal' | 'high' " +
      "(default 'normal'). Tags: workspace-scoped vocabulary, max " +
      "10 per item, max 20 unique tags per workspace (executor " +
      "enforces; rejects 21st with `tag_limit_exceeded`). Tags " +
      "REPLACE the existing array; pass [] to clear.\n\n" +
      "At least one of status/priority/tags must be supplied. " +
      "Output `changes` lists fields that actually changed.",
    inputSchema: setItemAttributesInputSchema,
    outputSchema: setItemAttributesOutputSchema,
  },
] as const;

/** Convenience map for orchestrator lookup by name. */
export const toolsByName: Readonly<Record<ToolName, ToolDefinition>> =
  Object.freeze(
    Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
      ToolName,
      ToolDefinition
    >,
  );
