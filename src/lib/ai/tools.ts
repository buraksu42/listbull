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
 *
 * Phase 14d: `dueAt` / `reminderSent` / `recurrenceRule` removed —
 * deadlines live on `deadlineAt`; reminders are their own table
 * surfaced via `itemReminderSnapshotSchema`.
 */
export const itemSnapshotSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  text: z.string(),
  description: z.string().nullable(),
  isCheckable: z.boolean(),
  isDone: z.boolean(),
  status: z.string(),
  priority: z.string(),
  tags: z.array(z.string()),
  assigneeId: z.string().uuid().nullable(),
  /** ISO 8601 — the moment the item is due. Null = no deadline. */
  deadlineAt: z.string().datetime({ offset: true }).nullable(),
  /** ISO timestamp set when the item was pinned to top; null = not pinned. */
  pinnedAt: z.string().datetime({ offset: true }).nullable(),
  /** RFC 5545 RRULE for task-level recurrence (auto-resurrect on complete). */
  taskRecurrenceRule: z.string().nullable(),
  position: z.number().int(),
  createdBy: z.string().uuid(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ItemSnapshotShape = z.infer<typeof itemSnapshotSchema>;

/**
 * JSON-safe reminder snapshot — mirror of `ItemReminderSnapshot` in
 * `src/lib/types/index.ts`. Returned alongside item rows on read APIs
 * and used in activity_log payloads for `item_reminder_added` /
 * `item_reminder_removed` / `item_reminder_fired`.
 */
export const itemReminderSnapshotSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  remindAt: z.string().datetime({ offset: true }),
  kind: z.enum(["absolute", "before_deadline"]),
  offsetMinutes: z.number().int().nonnegative().nullable(),
  recurrenceRule: z.string().nullable(),
  sent: z.boolean(),
  lastSentAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type ItemReminderSnapshotShape = z.infer<typeof itemReminderSnapshotSchema>;

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
    /**
     * Phase 14a: optional long-form context (≤5000 chars). For notes,
     * links, multi-line bodies — NOT a summary of `text`. Plain text
     * only; markdown is not rendered. Empty string is normalized to
     * null.
     */
    description: z.string().max(5000).nullable().optional(),
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
    /**
     * Phase 14d: renamed from `due_at`. The moment the item is due.
     * When provided, the executor also creates a single absolute
     * reminder anchored at the same moment so existing UX (set a
     * deadline → get a ping) is preserved.
     */
    deadline_at: z.string().datetime({ offset: true }).optional(),
    is_checkable: z.boolean().default(true),
  })
  .refine(
    (v) => !(v.is_checkable === false && v.deadline_at !== undefined),
    {
      message: "notes (is_checkable=false) cannot have deadline_at",
      path: ["deadline_at"],
    },
  );

export const createItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  list: listLiteSchema,
  /** Reminders created alongside the item (default = 1 if deadline_at set). */
  reminders: z.array(itemReminderSnapshotSchema),
  /** Soft warnings from the executor (e.g. deadline_at_in_past). */
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
   * Restrict to items with at least one active (future, unsent)
   * reminder in the `item_reminders` sibling table. `false` (default)
   * = no filter. Use this to answer "hangi hatırlatıcılar var?" /
   * "what reminders do I have?" — pair with empty `query` and no list
   * scope to get a workspace-wide active-reminders list.
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
 * Phase 14d: `due_at` → `deadline_at` rename. `deadline_at: null`
 * clears the deadline AND drops every `before_deadline` reminder for
 * the item (orphan reminders are meaningless without an anchor).
 * Absolute reminders survive a deadline clear. Omitting the field
 * leaves the deadline untouched.
 *
 * Reminders themselves are mutated through `set_deadline` /
 * `add_reminder` / `remove_reminder` — `update_item` no longer
 * manipulates reminders.
 */
export const updateItemInputSchema = z
  .object({
    item_id: z.string().uuid(),
    text: z.string().trim().min(1).max(2000).optional(),
    /**
     * Phase 14a: pass a string to set, explicit null to clear, omit
     * to leave untouched. Empty string is normalized to null.
     */
    description: z.string().max(5000).nullable().optional(),
    deadline_at: z.string().datetime({ offset: true }).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    /**
     * Move the item to a different list (same workspace). Pass either
     * the destination list's UUID OR its human-readable name — name is
     * resolved through the same exact/fuzzy matcher as `create_item`'s
     * `list_name`. UUID wins when both are supplied. Use `list_name` by
     * default; only reach for UUID when you've already resolved one
     * from `list_lists`/`search_items`. NEVER fabricate a UUID.
     */
    target_list_id: z.string().uuid().optional(),
    target_list_name: z.string().min(1).max(200).optional(),
    /**
     * Pin to top of the list (true) or remove the pin (false). Pinned
     * items sort above all others by `pinned_at DESC` (independent of
     * priority). Omit to leave the pin state unchanged.
     */
    pinned: z.boolean().optional(),
    /**
     * Task-level RFC 5545 RRULE. Pass a non-empty string (e.g.
     * `FREQ=WEEKLY;BYDAY=TH` for "every Thursday") to make this item
     * auto-resurrect on completion: the deadline advances to the
     * rule's next occurrence, `is_done` resets, `status` flips back
     * to `'open'`. Pass `null` to clear (one-shot task again). Omit
     * to leave unchanged. Distinct from reminder recurrence, which
     * only re-fires reminder pings without resurrecting the task.
     */
    task_recurrence_rule: z.string().trim().min(1).max(500).nullable().optional(),
    /**
     * Direct assignee assignment (Mini App fast path). Pass the
     * target user's UUID; pass null to clear. The user MUST already
     * be a list_member of the item's list (Inv-12). Bot path uses
     * `assign_item({assignee_username})` which resolves usernames to
     * IDs; this skips that step for UI surfaces that already have
     * the user_id from the members query.
     */
    assignee_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.description !== undefined ||
      v.deadline_at !== undefined ||
      v.position !== undefined ||
      v.target_list_id !== undefined ||
      v.target_list_name !== undefined ||
      v.pinned !== undefined ||
      v.task_recurrence_rule !== undefined ||
      v.assignee_id !== undefined,
    {
      message:
        "at least one of text, description, deadline_at, position, target_list_id, target_list_name, pinned, task_recurrence_rule, or assignee_id must be supplied",
    },
  );

export const updateItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  changes: z.array(
    z.enum([
      "text",
      "description",
      "deadline_at",
      "position",
      "list_id",
      "pinned",
      "task_recurrence_rule",
      "assignee_id",
    ]),
  ),
  /** Soft warnings (e.g. deadline_at_in_past). */
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
  /**
   * Soft warnings. Phase X (2026-05-09): `task_recurred` fires when
   * an item with `task_recurrence_rule` was "completed" but actually
   * auto-resurrected — deadline advanced, is_done reset. The LLM
   * should phrase the reply as "Tamam, sonraki: <new deadline>".
   */
  warnings: z.array(z.string()).optional(),
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
  /**
   * Phase 16: when true, creates the list as a repeatable checklist.
   * The Mini App renders simplified rows; "start a new run" resets
   * every item back to status='open' and logs a `list_runs` row.
   */
  is_checklist: z.boolean().optional(),
  /**
   * Phase 16/#28: list visibility within the workspace. 'public'
   * opens the list to every workspace member; 'private' keeps the
   * legacy list_members gate. Omit (or null) to inherit the
   * workspace's `default_list_visibility`.
   */
  visibility: z.enum(["public", "private"]).optional(),
});

export const createListOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
    is_checklist: z.boolean(),
    visibility: z.enum(["public", "private"]),
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
    /** Phase 16: toggle checklist mode on/off. */
    is_checklist: z.boolean().optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.emoji !== undefined ||
      v.is_checklist !== undefined,
    {
      message: "At least one of `name`, `emoji`, or `is_checklist` must be supplied",
    },
  );

export const updateListOutputSchema = z.object({
  list: z.object({
    id: z.string().uuid(),
    name: z.string(),
    emoji: z.string().nullable(),
    is_checklist: z.boolean(),
  }),
  changes: z.array(z.enum(["name", "emoji", "is_checklist"])),
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
    role: z.enum(["owner", "admin", "editor", "viewer", "guest"]),
  }),
});

export type SwitchWorkspaceInput = z.infer<typeof switchWorkspaceInputSchema>;
export type SwitchWorkspaceOutput = z.infer<typeof switchWorkspaceOutputSchema>;

// ─── 6f.5. create_workspace ──────────────────────────────────────────
//
// Create a fresh workspace owned by the caller. Mirrors POST
// /api/workspaces. The new workspace is NOT auto-activated; the LLM
// should follow up with `switch_workspace` if the user clearly
// intended to land there.

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const createWorkspaceOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    is_personal: z.boolean(),
  }),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type CreateWorkspaceOutput = z.infer<typeof createWorkspaceOutputSchema>;

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
// Owner-only rename. The slug auto-regenerates from the new name.

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
// Mirrors `share_list`'s deeplink + DM pattern but at workspace level.

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
  status: z.enum(["invite_sent", "already_member", "pending_phase_5"]),
  /** Telegram deeplink the inviter can copy + share when DM delivery
   *  fails (invitee hasn't /started the bot yet). Always present on
   *  status === "invite_sent"; absent on "already_member". */
  deeplink: z.string().url().optional(),
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
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-opus-4.7",
        "openai/gpt-4o-mini",
        "openai/gpt-4o",
        "openai/o1-mini",
        "google/gemini-2.5-flash",
        "google/gemini-2.5-pro",
        "x-ai/grok-3",
        "deepseek/deepseek-chat",
        "deepseek/deepseek-r1",
        "meta-llama/llama-3.3-70b-instruct",
      ])
      .optional(),
    notifications_enabled: z.boolean().optional(),
    /** Phase 14c: display preferences. */
    date_format: z.enum(["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
    time_format: z.enum(["24h", "12h"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message:
      "At least one of locale, timezone, llm_model, notifications_enabled, date_format, or time_format must be supplied",
  });

export const updateSettingsOutputSchema = z.object({
  locale: z.enum(["tr", "en"]),
  timezone: z.string(),
  llm_model: z.string(),
  notifications_enabled: z.boolean(),
  date_format: z.enum(["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  time_format: z.enum(["24h", "12h"]),
  changes: z.array(
    z.enum([
      "locale",
      "timezone",
      "llm_model",
      "notifications_enabled",
      "date_format",
      "time_format",
    ]),
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

// ─── 7c. create_snapshot — generate a public read-only snapshot URL ───
//
// Owner-only; Inbox cannot be snapshotted. Returns an HMAC-signed URL
// (default 30-day expiry) plus the matching markdown-ready text body
// the bot can post in the chat as a forwardable card. The URL targets
// `/snapshot/<listId>?sig=<hmac>&exp=<unix>` on the marketing surface
// (no auth required to view).

export const createSnapshotInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "one of list_id or list_name must be supplied",
    path: ["list_id"],
  });

export const createSnapshotOutputSchema = z.object({
  list: listLiteSchema,
  /** Public snapshot URL; embeds list_id + signed `sig`/`exp` query. */
  url: z.string(),
  /** ISO 8601 expiry (default now + 30 days). */
  expiresAt: z.string().datetime({ offset: true }),
});

export type CreateSnapshotInput = z.infer<typeof createSnapshotInputSchema>;
export type CreateSnapshotOutput = z.infer<typeof createSnapshotOutputSchema>;

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

// ─── 7e. list_workspace_invites — pending invites for active workspace
//
// Read-only enumeration of non-accepted, non-expired workspace_invites
// in the user's active workspace. Powers the bot's "bekleyen davetleri
// göster" answer + lets the LLM surface a copyable deeplink to manually
// hand out when the invitee never /starts the bot. Owner + admin only;
// pending invites can carry the deeplink URL.

export const listWorkspaceInvitesInputSchema = z.object({});

export const listWorkspaceInvitesOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  pendingInvites: z.array(
    z.object({
      token: z.string(),
      invitedUsername: z.string(),
      role: z.enum(["admin", "editor", "viewer", "guest"]),
      invitedAt: z.string(),
      expiresAt: z.string(),
      deeplink: z.string().url(),
    }),
  ),
});

export type ListWorkspaceInvitesInput = z.infer<
  typeof listWorkspaceInvitesInputSchema
>;
export type ListWorkspaceInvitesOutput = z.infer<
  typeof listWorkspaceInvitesOutputSchema
>;

// ─── 7f. cancel_workspace_invite — revoke pending workspace invite
//
// Mirrors cancel_invite but for workspace-level invites. Owner + admin
// only. PENDING-only; if the row is already accepted, surface
// `invite_already_accepted` so the LLM can pivot to remove_member.

export const cancelWorkspaceInviteInputSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "username is required")
    .max(33, "username must be ≤32 chars (plus optional leading @)"),
});

export const cancelWorkspaceInviteOutputSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  invitedUsername: z.string(),
  cancelledInviteId: z.string().uuid(),
});

export type CancelWorkspaceInviteInput = z.infer<
  typeof cancelWorkspaceInviteInputSchema
>;
export type CancelWorkspaceInviteOutput = z.infer<
  typeof cancelWorkspaceInviteOutputSchema
>;

// ─── 8. set_deadline (Phase 14d) ────────────────────────────────────
//
// Set or clear an item's deadline. Replaces the deadline-half of the
// retired `schedule_reminder` tool. Distinct from reminders —
// reminders are managed by `add_reminder` / `remove_reminder`.
//
// `deadline_at: null` (explicit) clears the deadline AND drops every
// `before_deadline` reminder for the item (orphan reminders are
// meaningless without an anchor). Absolute reminders survive a clear.
// Omitting the field → `invalid_input` (set vs clear must be explicit).
//
// When the deadline moves, every `before_deadline` reminder for that
// item has its `remind_at` recomputed in lock-step inside the same
// transaction. Recomputed reminders re-arm (sent reset to false) so a
// pushed-out deadline still pings — the user's intent on the new
// deadline is the new ping context.

export const setDeadlineInputSchema = z.object({
  item_id: z.string().uuid(),
  /** ISO 8601 with offset to set; explicit null to clear. */
  deadline_at: z.string().datetime({ offset: true }).nullable(),
});

export const setDeadlineOutputSchema = z.object({
  item: itemSnapshotSchema,
  /** Post-update reminders for the item — reflects the recompute. */
  reminders: z.array(itemReminderSnapshotSchema),
  /** True when the call cleared a previously-set deadline. */
  cleared: z.boolean(),
  /** Soft warnings (e.g. deadline_at_in_past). */
  warnings: z.array(z.string()).optional(),
});

export type SetDeadlineInput = z.infer<typeof setDeadlineInputSchema>;
export type SetDeadlineOutput = z.infer<typeof setDeadlineOutputSchema>;

// ─── 8b. add_reminder (Phase 14d) ───────────────────────────────────
//
// Append a reminder to an item. An item can have arbitrarily many
// reminders. Two kinds:
//   - 'absolute': pass `remind_at` (ISO 8601 with offset). May be
//     paired with `recurrence_rule` (RFC 5545 RRULE body, no prefix).
//   - 'before_deadline': pass `offset_minutes` (int ≥0). Requires the
//     item to already have a deadline; the actual `remind_at` is
//     computed as `items.deadline_at - offset_minutes` and recomputed
//     when the deadline moves. Recurrence is NOT allowed for this
//     kind (use absolute + RRULE if you need recurring offsets).
//
// XOR enforced via refine: provide exactly one of `remind_at` /
// `offset_minutes`. RRULE on offset → invalid_input.

export const addReminderInputSchema = z
  .object({
    item_id: z.string().uuid(),
    /** Absolute reminder time. ISO 8601 with offset. */
    remind_at: z.string().datetime({ offset: true }).optional(),
    /**
     * Minutes BEFORE the item's deadline to fire. Requires
     * `items.deadline_at` to be non-null at the time of the call.
     * 0 ≤ offset ≤ 525600 (one year).
     */
    offset_minutes: z.number().int().min(0).max(525600).optional(),
    /**
     * Optional RFC 5545 RRULE body (no `RRULE:` prefix, no DTSTART).
     * Only allowed when `remind_at` is provided. Times in the rule are
     * interpreted in UTC — convert local times accordingly. Pass null
     * or omit for one-shot.
     *
     * Examples:
     *   - "every Wednesday at 21:00 Europe/Istanbul" (no DST):
     *       FREQ=WEEKLY;BYDAY=WE;BYHOUR=18;BYMINUTE=0
     *   - "every weekday at 09:00 UTC":
     *       FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
     */
    recurrence_rule: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (v) => (v.remind_at !== undefined) !== (v.offset_minutes !== undefined),
    {
      message: "Provide exactly one of remind_at or offset_minutes.",
      path: ["remind_at"],
    },
  )
  .refine(
    (v) => !(v.offset_minutes !== undefined && v.recurrence_rule != null),
    {
      message: "recurrence_rule is only allowed with absolute reminders.",
      path: ["recurrence_rule"],
    },
  );

export const addReminderOutputSchema = z.object({
  reminder: itemReminderSnapshotSchema,
  /** Echo back the resolved kind so the LLM phrases correctly. */
  kind: z.enum(["absolute", "before_deadline"]),
  /** Soft warnings (e.g. remind_at_in_past). */
  warnings: z.array(z.string()).optional(),
});

export type AddReminderInput = z.infer<typeof addReminderInputSchema>;
export type AddReminderOutput = z.infer<typeof addReminderOutputSchema>;

// ─── 8d. attach_file_to_item (Phase 14b) ────────────────────────────
//
// Bind a Telegram file to an existing item. The bot pre-extracts file
// metadata from the inbound message and surfaces it to the LLM as a
// system overlay tag (`[ATTACHMENT_CONTEXT: file_id=... kind=...]`)
// so the LLM can call this tool with `file_id` it didn't fabricate.
//
// Flow when the user sends a file with a caption:
//   1. Bot intake parses the message → extract file_id + metadata.
//   2. LLM gets the caption as user input + the [ATTACHMENT_CONTEXT].
//   3. LLM typically calls `create_item(text=caption)` then
//      `attach_file_to_item(item_id=<new>, file_id=<from-context>, ...)`.
//   4. Executor: Inv-1 transactional INSERT + activity_log row.
//
// `attachment.id` is returned so a follow-up `remove_reminder`-like
// surface (or future `remove_attachment`) can reference it.

export const attachFileToItemInputSchema = z.object({
  item_id: z.string().uuid(),
  /** Telegram message field that produced the file. */
  kind: z.enum([
    "photo",
    "video",
    "document",
    "audio",
    "voice",
    "video_note",
  ]),
  /** Bot-scoped Telegram file_id; comes from [ATTACHMENT_CONTEXT]. */
  file_id: z.string().min(1).max(256),
  /** Bot-stable cross-bot id; used for per-item dedup. */
  file_unique_id: z.string().min(1).max(64).optional(),
  mime_type: z.string().max(128).optional(),
  /** Bytes; capped at the Telegram per-bot 2GB ceiling. */
  file_size: z.number().int().positive().max(2_000_000_000).optional(),
  duration: z.number().int().nonnegative().max(86_400).optional(),
  width: z.number().int().positive().max(8192).optional(),
  height: z.number().int().positive().max(8192).optional(),
  thumbnail_file_id: z.string().max(256).optional(),
  filename: z.string().max(256).optional(),
});

export const attachFileToItemOutputSchema = z.object({
  attachment: z.object({
    id: z.string().uuid(),
    item_id: z.string().uuid(),
    kind: z.enum([
      "photo",
      "video",
      "document",
      "audio",
      "voice",
      "video_note",
    ]),
    mime_type: z.string().nullable(),
    file_size: z.number().nullable(),
    original_filename: z.string().nullable(),
  }),
  item: itemSnapshotSchema,
});

export type AttachFileToItemInput = z.infer<typeof attachFileToItemInputSchema>;
export type AttachFileToItemOutput = z.infer<typeof attachFileToItemOutputSchema>;

// ─── 8e. start_checklist_run (Phase 16) ─────────────────────────────
//
// Open a new run on a checklist list. If a run is already active, it
// is auto-completed first (snapshot stats captured). Then every item
// in the list gets `status='open'` + `is_done=false` + `completed_at=null`
// so the user starts the new run with a clean slate. A
// `list_runs` row is inserted with `started_by_user_id = caller`.
//
// Errors:
//   - `not_a_checklist`: the resolved list has `is_checklist=false`.
//   - standard: `not_found`, `forbidden`, `ambiguous_list`.

export const startChecklistRunInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  });

export const startChecklistRunOutputSchema = z.object({
  list: listLiteSchema,
  /** Newly opened run. */
  run: z.object({
    id: z.string().uuid(),
    list_id: z.string().uuid(),
    started_at: z.string().datetime({ offset: true }),
    items_total: z.number().int().nonnegative(),
  }),
  /** Run that was auto-completed before opening, if any. */
  closed_previous_run_id: z.string().uuid().nullable(),
  items_reset: z.number().int().nonnegative(),
});

export type StartChecklistRunInput = z.infer<
  typeof startChecklistRunInputSchema
>;
export type StartChecklistRunOutput = z.infer<
  typeof startChecklistRunOutputSchema
>;

// ─── 8f. complete_checklist_run (Phase 16) ──────────────────────────
//
// Close the active run on a checklist list. Captures the
// items_completed stat at completion time. Idempotent: returns the
// existing closed run if no active run exists. Items are NOT reset on
// complete — only on `start_checklist_run`.

export const completeChecklistRunInputSchema = z
  .object({
    list_id: z.string().uuid().optional(),
    list_name: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.list_id !== undefined || v.list_name !== undefined, {
    message: "Either list_id or list_name is required",
  });

export const completeChecklistRunOutputSchema = z.object({
  list: listLiteSchema,
  run: z
    .object({
      id: z.string().uuid(),
      list_id: z.string().uuid(),
      started_at: z.string().datetime({ offset: true }),
      completed_at: z.string().datetime({ offset: true }),
      items_total: z.number().int().nonnegative(),
      items_completed: z.number().int().nonnegative(),
    })
    .nullable(),
  /** True when the active run was closed, false when there was none. */
  closed: z.boolean(),
});

export type CompleteChecklistRunInput = z.infer<
  typeof completeChecklistRunInputSchema
>;
export type CompleteChecklistRunOutput = z.infer<
  typeof completeChecklistRunOutputSchema
>;

// ─── 8c. remove_reminder (Phase 14d) ────────────────────────────────
//
// Delete a single reminder by id. Item write-permission required
// (executor verifies via the parent item's list). Does NOT touch the
// item's deadline.

export const removeReminderInputSchema = z.object({
  reminder_id: z.string().uuid(),
});

export const removeReminderOutputSchema = z.object({
  reminder_id: z.string().uuid(),
  item_id: z.string().uuid(),
});

export type RemoveReminderInput = z.infer<typeof removeReminderInputSchema>;
export type RemoveReminderOutput = z.infer<typeof removeReminderOutputSchema>;

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
  "create_snapshot",
  "cancel_invite",
  "list_workspace_invites",
  "cancel_workspace_invite",
  "list_members",
  "remove_member",
  "update_member_role",
  "update_settings",
  // Phase 14d: split deadline / reminder tools
  "set_deadline",
  "add_reminder",
  "remove_reminder",
  // Phase 14b: file attachments
  "attach_file_to_item",
  // Phase 16: checklists
  "start_checklist_run",
  "complete_checklist_run",
  "assign_item",
  // Phase 4.5: workspace + item-discipline tools
  "create_workspace",
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
      "notes can't have a `deadline_at` and can't be completed. " +
      "`description` is optional long-form context (≤5000 chars) for " +
      "notes / links / multi-line bodies — DO NOT use it as a summary " +
      "of `text`. Keep `text` short (the title) and put extra detail " +
      "in `description`. Plain text only; markdown is not rendered. " +
      "`deadline_at` must be ISO 8601 in the future; past times are " +
      "silently dropped with a warning. When `deadline_at` is set, " +
      "the executor also creates one default absolute reminder at the " +
      "same moment so the user gets pinged when the item is due. To " +
      "add additional reminders or before-deadline reminders, follow " +
      "up with `add_reminder` calls. Use this for any 'add', 'note', " +
      "'remind me' intent.",
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
      "to restrict to items with at least one ACTIVE FUTURE reminder " +
      "(unsent row in `item_reminders` whose remind_at is still in the " +
      "future) — use this for 'hangi hatırlatıcılar var?' / 'what " +
      "reminders do I have?'. Returns items with their list context " +
      "plus the list of scanned lists.",
    inputSchema: searchItemsInputSchema,
    outputSchema: searchItemsOutputSchema,
  },
  {
    name: "update_item",
    description:
      "Edit an existing item's text, description, deadline, position, MOVE it to " +
      "a different list (same workspace), or PIN it to top. At least " +
      "one of `text`, `deadline_at`, `position`, `target_list_id`, " +
      "`target_list_name`, or `pinned` must be supplied. To MOVE: " +
      "pass `target_list_name` (e.g. \"Inbox\", \"Muhasebe\") — the " +
      "executor resolves the name like `create_item` does (exact → " +
      "fuzzy → Inbox fallback). Use `target_list_id` only when you " +
      "already have the UUID from a prior `list_lists`/`search_items` " +
      "call. NEVER fabricate a UUID. To PIN: pass `pinned: true` " +
      "(stamps `pinned_at = now()`); the item floats to top of its " +
      "list, sorted by `pinned_at DESC` independent of priority. Pass " +
      "`pinned: false` to UNPIN. Phrasings: \"sabitle\", \"pin to top\", " +
      "\"sabitlemeyi kaldır\", \"unpin\". History + completion state " +
      "preserved (always prefer over delete+recreate). Pass " +
      "`description: '<text>'` to set or `description: null` to clear " +
      "the long-form body. " +
      "`deadline_at: null` to CLEAR the deadline (also drops " +
      "before-deadline reminders); omitting leaves it unchanged. " +
      "Past `deadline_at` silently dropped with warning. To manage " +
      "REMINDERS (set/clear ping moments), use `set_deadline` / " +
      "`add_reminder` / `remove_reminder` — `update_item` no longer " +
      "touches reminders. " +
      "Pass `task_recurrence_rule` (RFC 5545 RRULE body, no `RRULE:` " +
      "prefix) to make the item AUTO-RESURRECT when completed: on " +
      "complete, deadline advances to the next occurrence and " +
      "is_done resets. Phrasings: \"her hafta perşembe yenile\" → " +
      "`FREQ=WEEKLY;BYDAY=TH`; \"her ay 1'i\" → " +
      "`FREQ=MONTHLY;BYMONTHDAY=1`; \"her gün\" → `FREQ=DAILY`. Pass " +
      "`task_recurrence_rule: null` to clear (one-shot again). " +
      "Distinct from reminder recurrence (`add_reminder`'s " +
      "recurrence_rule) which only re-pings without resurrecting. " +
      "`changes` names the fields that actually changed.",
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
    name: "create_snapshot",
    description:
      "Generate a public read-only snapshot URL for a list — anyone " +
      "with the link can view its current contents (no login required). " +
      "Use for phrasings like \"X listesi için snapshot link al\", " +
      "\"share a snapshot of my reading list\", \"link to send to a " +
      "friend\". Identify the list by `list_name` when known (preferred), " +
      "else `list_id`. Owner-only — non-owners get `forbidden`. Inbox " +
      "cannot be snapshotted (`cannot_snapshot_inbox`). Snapshots expire " +
      "after 30 days (`expiresAt` in output) and re-issuing returns a " +
      "fresh URL. Echo the URL back verbatim in your reply; the page " +
      "renders the same items list the user sees in the Mini App.",
    inputSchema: createSnapshotInputSchema,
    outputSchema: createSnapshotOutputSchema,
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
    name: "list_workspace_invites",
    description:
      "READ-ONLY enumeration of pending workspace invites in the " +
      "user's active workspace (non-accepted, non-expired). Owner + " +
      "admin only. Use this when the user asks 'bekleyen davetler' " +
      "/ 'kimi davet ettim?' / 'X'in davet durumu nedir?'. Returns " +
      "each invite's `invitedUsername`, `role`, `deeplink` (the " +
      "Telegram link the inviter can manually re-share when the " +
      "invitee hasn't /started the bot), plus `invitedAt` / " +
      "`expiresAt` timestamps. No input — operates on the active " +
      "workspace.",
    inputSchema: listWorkspaceInvitesInputSchema,
    outputSchema: listWorkspaceInvitesOutputSchema,
  },
  {
    name: "cancel_workspace_invite",
    description:
      "Revoke a PENDING workspace invite (OWNER + ADMIN only). " +
      "Identifies the invite by `username` alone — workspace invites " +
      "are scoped to the active workspace, no need to pass " +
      "workspace_id. Use when the user says '@ali'nin davetini iptal " +
      "et' / 'davet linkini geri al' / 'davet sil'. Only PENDING " +
      "(non-accepted) invites can be canceled. If the invitee has " +
      "ALREADY ACCEPTED, the executor returns `invite_already_accepted` " +
      "— pivot to `remove_workspace_member` and tell the user '@ali " +
      "daveti zaten kabul etmişti, workspace'ten çıkardım'. Distinct " +
      "from `cancel_invite` which targets list-level invites.",
    inputSchema: cancelWorkspaceInviteInputSchema,
    outputSchema: cancelWorkspaceInviteOutputSchema,
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
      "suppressed), `date_format` ('DD.MM.YYYY' | 'MM/DD/YYYY' | " +
      "'YYYY-MM-DD'), `time_format` ('24h' | '12h'). At least one " +
      "must be supplied. Use this when the user says 'saat dilimi " +
      "İstanbul olsun' / 'use Istanbul time' / 'set my timezone' / " +
      "'change to English' / 'turn off reminders' / 'tarih formatını " +
      "MM/DD/YYYY yap' / 'switch to 12-hour clock'. BYOK API key " +
      "cannot be set this way (security: chat history would persist " +
      "the secret) — direct the user to the Mini App settings page " +
      "for that. Output `changes` lists fields that actually changed; " +
      "use it to phrase a precise confirmation.",
    inputSchema: updateSettingsInputSchema,
    outputSchema: updateSettingsOutputSchema,
  },
  {
    name: "set_deadline",
    description:
      "Set or clear an item's deadline — the moment the item is due. " +
      "Distinct from reminders: deadlines mark the due moment, " +
      "reminders are when to PING. Pass `item_id` (resolve via " +
      "`search_items` first if you only have item text) and " +
      "`deadline_at` (ISO 8601 with offset to set, or explicit null " +
      "to clear). Past values are silently dropped with warning " +
      "`deadline_at_in_past` — re-prompt for a future time. Notes " +
      "(`is_checkable=false`) cannot have a deadline " +
      "(`cannot_schedule_note`). When the deadline moves, every " +
      "`before_deadline` reminder for the item is recomputed " +
      "automatically — DO NOT delete+recreate them. Clearing the " +
      "deadline (`deadline_at: null`) drops every `before_deadline` " +
      "reminder for the item; absolute reminders survive. Use this " +
      "for 'son tarihi cuma 18:00 yap' / 'deadline'ı pazartesi sabaha " +
      "al' / 'son tarihi kaldır'. To create a NEW item with a " +
      "deadline, call `create_item` with `deadline_at` instead.",
    inputSchema: setDeadlineInputSchema,
    outputSchema: setDeadlineOutputSchema,
  },
  {
    name: "add_reminder",
    description:
      "Append a reminder to an item — separate from the deadline. An " +
      "item may have arbitrarily many reminders. Pass `item_id` and " +
      "EXACTLY ONE of:\n" +
      "  - `remind_at` (ISO 8601 with offset) → an ABSOLUTE reminder " +
      "    at a fixed moment. May include `recurrence_rule` (RFC 5545 " +
      "    RRULE body, no `RRULE:` prefix) to recur. Times in RRULE " +
      "    are interpreted in UTC — convert local times before " +
      "    emitting (e.g. `21:00 Europe/Istanbul = 18:00 UTC`).\n" +
      "  - `offset_minutes` (int ≥0) → a BEFORE-DEADLINE reminder. " +
      "    Requires `items.deadline_at` to be non-null at call time. " +
      "    The reminder fires `offset_minutes` before the deadline " +
      "    and re-anchors automatically when the deadline moves. " +
      "    Recurrence is NOT allowed for this kind.\n" +
      "Use `add_reminder` for utterances like 'perşembe 09:00 da " +
      "ping at', '1 gün önce hatırlat', 'her hafta içi 09:00'da " +
      "uyandır'. Past `remind_at` is dropped with warning " +
      "`remind_at_in_past`. Examples of RRULE: weekly Wednesday 18:00 " +
      "UTC = `FREQ=WEEKLY;BYDAY=WE;BYHOUR=18;BYMINUTE=0`; weekday " +
      "daily 09:00 UTC = `FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;" +
      "BYMINUTE=0`. Common error envelopes: `not_found`, `forbidden`, " +
      "`deadline_required` (offset reminder on item with no deadline), " +
      "`invalid_input` (XOR violation, RRULE on offset).",
    inputSchema: addReminderInputSchema,
    outputSchema: addReminderOutputSchema,
  },
  {
    name: "remove_reminder",
    description:
      "Delete a single reminder by id. Pass `reminder_id` (UUID). Use " +
      "`search_items` to find the parent item, then read its " +
      "`reminders` array to find the id; for 'hatırlatmayı kaldır' " +
      "without disambiguation, ask the user which one if there are " +
      "multiple. Does NOT touch the item's deadline. Common error " +
      "envelopes: `not_found`, `forbidden`.",
    inputSchema: removeReminderInputSchema,
    outputSchema: removeReminderOutputSchema,
  },
  {
    name: "attach_file_to_item",
    description:
      "Bind a file the user just sent in chat to an EXISTING item. " +
      "The bot intake layer pre-extracts file metadata into a system " +
      "overlay `[ATTACHMENT_CONTEXT: file_id=<...> kind=<...> " +
      "mime=<...> ...]` on the same user turn — pull `file_id` and " +
      "the other metadata from THERE. NEVER fabricate file_ids. " +
      "Required inputs: `item_id`, `kind` (one of 'photo', 'video', " +
      "'document', 'audio', 'voice', 'video_note'), `file_id`. " +
      "Optional inputs: `file_unique_id` (used for dedup; if omitted, " +
      "a re-send creates a duplicate row), `mime_type`, `file_size`, " +
      "`duration`, `width`, `height`, `thumbnail_file_id`, `filename`. " +
      "Typical flow when the user sends a file with caption 'Süt al': " +
      "first call `create_item(text='Süt al')`, then call " +
      "`attach_file_to_item` with the new `item_id` and the file_id " +
      "from the [ATTACHMENT_CONTEXT]. When the user sends a file " +
      "without a clear caption ('hangi maddeye?'), ask which item — " +
      "do not fabricate text. To attach to an existing item the user " +
      "named ('bu fotoyu süt'e ekle'), call `search_items` first to " +
      "resolve the id, then this tool.",
    inputSchema: attachFileToItemInputSchema,
    outputSchema: attachFileToItemOutputSchema,
  },
  {
    name: "start_checklist_run",
    description:
      "Open a new run on a checklist list. Use when the user says " +
      "'sabah rutinine başla', 'pre-flight check başlat', 'reset the " +
      "morning checklist', 'çalıştır şu kontrol listesini'. Pass " +
      "`list_id` (preferred) or `list_name` to identify the list — " +
      "the resolved list MUST have `is_checklist=true` (otherwise " +
      "returns `not_a_checklist` and the LLM should ask the user to " +
      "convert it via `update_list({is_checklist: true})` first). " +
      "Side effects: any active run is auto-completed (stats " +
      "snapshot captured), then every item is reset to `status='open'` " +
      "+ `is_done=false`, then a new `list_runs` row opens. The " +
      "user's existing item descriptions / deadlines / reminders / " +
      "tags are preserved — only state resets. Reply with something " +
      "like 'X listesinde {N} maddenin tamamı sıfırlandı, yeni run " +
      "başlatıldı'.",
    inputSchema: startChecklistRunInputSchema,
    outputSchema: startChecklistRunOutputSchema,
  },
  {
    name: "complete_checklist_run",
    description:
      "Close the active run on a checklist list WITHOUT resetting " +
      "items. Use when the user says 'rutini bitirdim', 'mark the " +
      "checklist run done', 'kapat şu kontrol listesini'. Captures " +
      "`items_completed` stat for the run history. Idempotent: when " +
      "no active run exists the call returns `closed: false` with " +
      "`run: null` — phrase that as 'aktif run yoktu' rather than " +
      "an error. To start a fresh pass, call `start_checklist_run` " +
      "instead — it auto-completes the active run AND resets items.",
    inputSchema: completeChecklistRunInputSchema,
    outputSchema: completeChecklistRunOutputSchema,
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
    name: "create_workspace",
    description:
      "Create a brand new workspace owned by the caller. Use when the " +
      "user says 'yeni workspace oluştur', 'new workspace', 'create a " +
      "workspace called <name>'. Pass `name` (1-120 chars). Returns " +
      "the new workspace shape; the new workspace is NOT auto-active " +
      "— if the user clearly intended to switch into it (e.g. 'iş " +
      "diye yeni workspace aç ve oraya geç'), call `switch_workspace` " +
      "with the returned `workspace.id` next.",
    inputSchema: createWorkspaceInputSchema,
    outputSchema: createWorkspaceOutputSchema,
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
      "The slug auto-regenerates. Use when the user says 'workspace " +
      "adını <X> yap' / 'rename my workspace to <X>'. Personal " +
      "Workspace can be renamed freely; the `is_personal` flag stays.",
    inputSchema: updateWorkspaceInputSchema,
    outputSchema: updateWorkspaceOutputSchema,
  },
  {
    name: "invite_to_workspace",
    description:
      "Invite a Telegram user to the active workspace as `admin`, " +
      "`editor` (default), `viewer`, or `guest`. OWNER + ADMIN can " +
      "call. Operates on the user's ACTIVE workspace — no list_id / " +
      "list_name argument; switch workspaces first if needed. Pass " +
      "`username` (with or without leading @ — case is normalized).\n\n" +
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
