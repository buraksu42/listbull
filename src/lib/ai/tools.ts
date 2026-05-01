/**
 * LLM tool registry for listgram Phase 2.
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
 * `docs/architecture-pass-phase-2.md` for the canonical description.
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
] as const;

/** Convenience map for orchestrator lookup by name. */
export const toolsByName: Readonly<Record<ToolName, ToolDefinition>> =
  Object.freeze(
    Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
      ToolName,
      ToolDefinition
    >,
  );
