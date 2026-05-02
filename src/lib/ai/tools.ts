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
  query: z
    .string()
    .trim()
    .min(1, "query is required")
    .max(500, "query must be ≤500 chars"),
  list_id: z.string().uuid().optional(),
  list_name: z.string().min(1).max(200).optional(),
  include_done: z.boolean().default(false),
  include_archived: z.boolean().default(false),
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
  })
  .refine(
    (v) =>
      v.text !== undefined || v.due_at !== undefined || v.position !== undefined,
    {
      message:
        "at least one of text, due_at, or position must be supplied",
    },
  );

export const updateItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  changes: z.array(z.enum(["text", "due_at", "position"])),
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
  "share_list",
  "schedule_reminder",
  "assign_item",
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
      "Search the user's items by substring match on item text. " +
      "Scope to one list with `list_id` or `list_name`; with both " +
      "absent, search across ALL lists the user has access to (the " +
      "common case for 'did I add X?'). By default, completed and " +
      "archived items are excluded. Returns matched items with their " +
      "list context plus the list of lists actually scanned, so you " +
      "can answer contextually ('Sapiens'i Okuma listende buldum').",
    inputSchema: searchItemsInputSchema,
    outputSchema: searchItemsOutputSchema,
  },
  {
    name: "update_item",
    description:
      "Edit an existing item's text, due date, or position. At least " +
      "one of `text`, `due_at`, or `position` must be supplied. Pass " +
      "`due_at: null` (explicit) to CLEAR a reminder; omitting `due_at` " +
      "leaves it unchanged. Past `due_at` values are silently dropped " +
      "with a warning. `changes` in the output names the fields that " +
      "actually changed — use it to phrase a precise confirmation.",
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
      "If you want to create a fresh item WITH a reminder, call " +
      "`create_item` with `due_at` instead — `schedule_reminder` is " +
      "for already-existing items only. Common error envelopes: " +
      "`not_found`, `forbidden`, `invalid_input` " +
      "(`cannot_schedule_note`).",
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
] as const;

/** Convenience map for orchestrator lookup by name. */
export const toolsByName: Readonly<Record<ToolName, ToolDefinition>> =
  Object.freeze(
    Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
      ToolName,
      ToolDefinition
    >,
  );
