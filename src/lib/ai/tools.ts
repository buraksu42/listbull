/**
 * LLM tool registry — Phase 17 (chat-only pivot).
 *
 * One chat = one to-do list. Workspaces + multi-list + sharing
 * primitives have been removed; items belong directly to a Telegram
 * chat (DM or group). The LLM operates on the chat it was invoked
 * from; cross-chat moves and list selection no longer exist.
 *
 * Each tool exports:
 *   - input zod schema  → `<tool>InputSchema`
 *   - output zod schema → `<tool>OutputSchema`
 *   - inferred TS types → `<Tool>Input`, `<Tool>Output`
 *
 * Backend executors (src/lib/server/tools/**) re-validate inputs
 * against the same zod schemas for defense in depth.
 */
import { z } from "zod";

import { LLM_MODEL_SLUG_REGEX } from "@/lib/validators/settings";

// ═══════════════════════════════════════════════════════════════════
// Shared sub-schemas
// ═══════════════════════════════════════════════════════════════════

/**
 * JSON-safe item snapshot. Mirrors `ItemSnapshot` in
 * `src/lib/types/index.ts`. Dates serialize as ISO 8601 with offset.
 */
export const itemSnapshotSchema = z.object({
  id: z.string().uuid(),
  /** BigInt chat_id as JSON number; Telegram chat_ids fit safely. */
  chatId: z.number().int(),
  text: z.string(),
  description: z.string().nullable(),
  isCheckable: z.boolean(),
  isDone: z.boolean(),
  status: z.string(),
  priority: z.string(),
  tags: z.array(z.string()),
  deadlineAt: z.string().datetime({ offset: true }).nullable(),
  pinnedAt: z.string().datetime({ offset: true }).nullable(),
  taskRecurrenceRule: z.string().nullable(),
  position: z.number().int(),
  createdBy: z.string().uuid(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** 'todo' | 'memory' | 'secret' — discriminator (Phase 17b). */
  kind: z.enum(["todo", "memory", "secret"]),
  /** Nested-item parent; null for top-level. */
  parentItemId: z.string().uuid().nullable(),
});

export type ItemSnapshotShape = z.infer<typeof itemSnapshotSchema>;

/** JSON-safe reminder snapshot. */
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

// ═══════════════════════════════════════════════════════════════════
// 1. create_item
// ═══════════════════════════════════════════════════════════════════

export const createItemInputSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "text is required")
      .max(2000, "text must be ≤2000 chars"),
    /**
     * Optional long-form context (≤5000 chars). For notes, links,
     * multi-line bodies — NOT a summary of `text`. Plain text only;
     * markdown is not rendered. Empty string is normalized to null.
     */
    description: z.string().max(5000).nullable().optional(),
    /**
     * The moment the item is due. When provided, the executor also
     * creates a single absolute reminder anchored at the same moment
     * so the existing UX (set a deadline → get a ping) is preserved.
     */
    deadline_at: z.string().datetime({ offset: true }).optional(),
    is_checkable: z.boolean().default(true),
    /**
     * Phase 17b: discriminator. 'todo' is the default; 'memory' marks
     * never-auto-delete keepsakes (tickets, docs, receipts) and is
     * protected from delete_item/complete_item. 'secret' is reserved
     * for the /şifre slash flow — LLM must NOT create secrets directly.
     */
    kind: z.enum(["todo", "memory"]).optional().default("todo"),
    /**
     * Phase 17b: when set, the new item becomes a nested sub-item of
     * the given parent (e.g. "Paris seyahati" → "pasaport", "uçak
     * bileti", "otel"). Parent must exist in the same chat and not be
     * archived. Mostly used inside memory mode but allowed for todos
     * too.
     */
    parent_item_id: z.string().uuid().optional(),
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
  reminders: z.array(itemReminderSnapshotSchema),
  warnings: z.array(z.string()).optional(),
});

export type CreateItemInput = z.infer<typeof createItemInputSchema>;
export type CreateItemOutput = z.infer<typeof createItemOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 2. search_items
// ═══════════════════════════════════════════════════════════════════

export const searchItemsInputSchema = z.object({
  /**
   * Empty query is allowed — returns all items in the current chat
   * sorted by recency. With a non-empty query, ILIKE on items.text +
   * items.description.
   */
  query: z.string().trim().max(500, "query must be ≤500 chars").default(""),
  include_done: z.boolean().default(false),
  include_archived: z.boolean().default(false),
  /**
   * Restrict to items with at least one active (future, unsent)
   * reminder. Use this to answer "hangi hatırlatıcılar var?".
   */
  has_reminder: z.boolean().default(false),
  /**
   * Phase 17b: discriminator filter. Defaults to 'todo' so backward-
   * compat is preserved (existing search calls keep returning to-dos
   * only). Pass 'memory' to find memory items, 'secret' for password
   * lookups (the executor still enforces DM-only on secrets), or 'any'
   * to search the whole chat.
   */
  kind: z.enum(["todo", "memory", "secret", "any"]).optional().default("todo"),
  /**
   * Phase 17c: nesting filter.
   *   "any"  → don't filter (default; preserves pre-17c behavior)
   *   "none" → top-level only (parent_item_id IS NULL); use this to
   *            recover the /items view shape.
   *   <uuid> → children of the given parent_item_id; use to enumerate
   *            sub-items of a known checklist parent.
   */
  parent_item_id: z
    .union([z.literal("any"), z.literal("none"), z.string().uuid()])
    .optional()
    .default("any"),
  limit: z.number().int().min(1).max(50).default(20),
});

export const searchItemsOutputSchema = z.object({
  results: z.array(
    z.object({
      item: itemSnapshotSchema,
      score: z.number().min(0).max(1),
    }),
  ),
  total_matched: z.number().int().nonnegative(),
});

export type SearchItemsInput = z.infer<typeof searchItemsInputSchema>;
export type SearchItemsOutput = z.infer<typeof searchItemsOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 3. update_item
// ═══════════════════════════════════════════════════════════════════

export const updateItemInputSchema = z
  .object({
    item_id: z.string().uuid(),
    text: z.string().trim().min(1).max(2000).optional(),
    description: z.string().max(5000).nullable().optional(),
    deadline_at: z.string().datetime({ offset: true }).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    pinned: z.boolean().optional(),
    task_recurrence_rule: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (v) =>
      v.text !== undefined ||
      v.description !== undefined ||
      v.deadline_at !== undefined ||
      v.position !== undefined ||
      v.pinned !== undefined ||
      v.task_recurrence_rule !== undefined,
    {
      message: "at least one of text/description/deadline_at/position/pinned/task_recurrence_rule must be supplied",
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
      "pinned",
      "task_recurrence_rule",
    ]),
  ),
  reminders: z.array(itemReminderSnapshotSchema).optional(),
  warnings: z.array(z.string()).optional(),
});

export type UpdateItemInput = z.infer<typeof updateItemInputSchema>;
export type UpdateItemOutput = z.infer<typeof updateItemOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 4. complete_item
// ═══════════════════════════════════════════════════════════════════

export const completeItemInputSchema = z.object({
  item_id: z.string().uuid(),
  /** Default true; pass false to "uncheck". */
  is_done: z.boolean().default(true),
});

export const completeItemOutputSchema = z.object({
  item: itemSnapshotSchema,
  /**
   * When `item.task_recurrence_rule` was set, the executor clones the
   * item: `item` is the now-done original (lands in /done), `new_item`
   * is the freshly-inserted next cycle (lives in /items) carrying the
   * same text / description / reminders / attachments and a new
   * deadline at the rule's next occurrence. Absent on non-recurring
   * completions and on rule-exhausted (UNTIL= past) completions.
   */
  new_item: itemSnapshotSchema.optional(),
  /** When the item had task_recurrence_rule and we cloned instead of marking done permanently. */
  warnings: z.array(z.string()).optional(),
});

export type CompleteItemInput = z.infer<typeof completeItemInputSchema>;
export type CompleteItemOutput = z.infer<typeof completeItemOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 5. delete_item
// ═══════════════════════════════════════════════════════════════════

export const deleteItemInputSchema = z.object({
  item_id: z.string().uuid(),
  /**
   * Phase 17b: hard 2-step gate. The first call must omit / set
   * `confirmed: false` and the executor returns a
   * `confirmation_required` error. The LLM then asks the user
   * ("🗑️ X silinsin mi? Emin misin?"). Only when the user replies
   * with explicit confirmation (evet / sil / onayla / yes / delete)
   * does the LLM call delete_item again with `confirmed: true`.
   */
  confirmed: z.boolean().optional().default(false),
});

export const deleteItemOutputSchema = z.object({
  item: itemSnapshotSchema,
});

export type DeleteItemInput = z.infer<typeof deleteItemInputSchema>;
export type DeleteItemOutput = z.infer<typeof deleteItemOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 6. set_deadline
// ═══════════════════════════════════════════════════════════════════

export const setDeadlineInputSchema = z.object({
  item_id: z.string().uuid(),
  /** ISO 8601 with offset, or null to clear. */
  deadline_at: z.string().datetime({ offset: true }).nullable(),
});

export const setDeadlineOutputSchema = z.object({
  item: itemSnapshotSchema,
  reminders: z.array(itemReminderSnapshotSchema),
});

export type SetDeadlineInput = z.infer<typeof setDeadlineInputSchema>;
export type SetDeadlineOutput = z.infer<typeof setDeadlineOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 7. add_reminder
// ═══════════════════════════════════════════════════════════════════

export const addReminderInputSchema = z
  .object({
    item_id: z.string().uuid(),
    /** ISO 8601 — absolute reminder moment. */
    remind_at: z.string().datetime({ offset: true }).optional(),
    /** Alternative to remind_at: minutes before the item's deadline. */
    offset_minutes: z.number().int().nonnegative().optional(),
    /** RFC 5545 RRULE for absolute reminders (no offset_minutes). */
    recurrence_rule: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (v) =>
      (v.remind_at !== undefined) !== (v.offset_minutes !== undefined),
    {
      message: "exactly one of remind_at or offset_minutes must be supplied",
    },
  )
  .refine(
    (v) => !(v.offset_minutes !== undefined && v.recurrence_rule),
    {
      message: "recurrence_rule is only allowed with absolute reminders",
      path: ["recurrence_rule"],
    },
  );

export const addReminderOutputSchema = z.object({
  reminder: itemReminderSnapshotSchema,
});

export type AddReminderInput = z.infer<typeof addReminderInputSchema>;
export type AddReminderOutput = z.infer<typeof addReminderOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 8. remove_reminder
// ═══════════════════════════════════════════════════════════════════

export const removeReminderInputSchema = z.object({
  reminder_id: z.string().uuid(),
});

export const removeReminderOutputSchema = z.object({
  removed: z.boolean(),
});

export type RemoveReminderInput = z.infer<typeof removeReminderInputSchema>;
export type RemoveReminderOutput = z.infer<typeof removeReminderOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 9. set_item_attributes
// ═══════════════════════════════════════════════════════════════════
//
// Status / priority / tags. Tag limit: 20 unique tags per chat.

export const setItemAttributesInputSchema = z
  .object({
    item_id: z.string().uuid(),
    status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    /** Replace tags (not append). Pass [] to clear. */
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    /**
     * Phase 17b: promote a todo → memory or demote memory → todo.
     * 'secret' is not allowed via this tool — secrets are created and
     * destroyed only through the /şifre slash flow.
     */
    kind: z.enum(["todo", "memory"]).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined ||
      v.kind !== undefined,
    {
      message:
        "at least one of status/priority/tags/kind must be supplied",
    },
  );

export const setItemAttributesOutputSchema = z.object({
  item: itemSnapshotSchema,
  changes: z.array(z.enum(["status", "priority", "tags", "kind"])),
});

export type SetItemAttributesInput = z.infer<typeof setItemAttributesInputSchema>;
export type SetItemAttributesOutput = z.infer<typeof setItemAttributesOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 11. update_settings (user prefs, unchanged from pre-pivot)
// ═══════════════════════════════════════════════════════════════════

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
    // The bot picker shows a curated list (LLM_MODEL_META in
    // validators/settings.ts), but power users may type a slug not on
    // it ("modelimi qwen/qwen-max yap"). Accept any well-formed
    // OpenRouter slug; invalid ones fail at runtime when OpenRouter
    // returns 404, which we surface as a chat error.
    llm_model: z
      .string()
      .min(3)
      .max(96)
      .regex(LLM_MODEL_SLUG_REGEX, {
        message:
          "llm_model must be an OpenRouter slug like provider/model-name",
      })
      .optional(),
    notifications_enabled: z.boolean().optional(),
    date_format: z.enum(["DD.MM.YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
    time_format: z.enum(["24h", "12h"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message:
      "at least one of locale/timezone/llm_model/notifications_enabled/date_format/time_format must be supplied",
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

// ═══════════════════════════════════════════════════════════════════
// 12. attach_file_to_item
// ═══════════════════════════════════════════════════════════════════

export const attachFileToItemInputSchema = z.object({
  item_id: z.string().uuid(),
  /** Telegram file_id (rotates with bot token). */
  file_id: z.string().min(1),
  /** Stable cross-bot file_unique_id; used for dedup. */
  file_unique_id: z.string().optional(),
  kind: z.enum(["photo", "video", "document", "audio", "voice", "video_note"]),
  mime_type: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
  duration: z.number().int().nonnegative().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  thumbnail_file_id: z.string().optional(),
  filename: z.string().optional(),
});

export const attachFileToItemOutputSchema = z.object({
  attachment: z.object({
    id: z.string().uuid(),
    item_id: z.string().uuid(),
    kind: z.string(),
    telegram_file_id: z.string(),
    mime_type: z.string().nullable(),
    file_size: z.number().int().nullable(),
  }),
});

export type AttachFileToItemInput = z.infer<typeof attachFileToItemInputSchema>;
export type AttachFileToItemOutput = z.infer<typeof attachFileToItemOutputSchema>;

// Phase 17b: checklist tools (`start_checklist_run` /
// `complete_checklist_run`) were dropped from the registry because
// the executors were never wired post-pivot — the LLM kept telling
// users "checklist özelliği yenileniyor" which was a hallucination
// on top of a stub. Chat-only model uses tags + multiple items for
// grouped tasks instead.

// ═══════════════════════════════════════════════════════════════════
// 13. set_chat_api_key (Phase 17, renamed from set_workspace_api_key)
// ═══════════════════════════════════════════════════════════════════
//
// User pastes their OpenRouter API key in chat; executor encrypts +
// stores on chats.openrouter_api_key_encrypted. Owner-only.
//
// Telegram-side hygiene (handle-message.ts):
//   - DM user-message is deleteMessage'd best-effort.
//   - persisted message content is regex-redacted before insert.

export const setChatApiKeyInputSchema = z.object({
  api_key: z
    .string()
    .trim()
    .regex(/^sk-or-v1-[A-Za-z0-9_-]{20,}$/, {
      message: "api_key must start with sk-or-v1- and be ≥30 characters",
    }),
});

export const setChatApiKeyOutputSchema = z.object({
  chat: z.object({
    chat_id: z.number().int(),
    title: z.string().nullable(),
  }),
  key_suffix: z.string(),
});

export type SetChatApiKeyInput = z.infer<typeof setChatApiKeyInputSchema>;
export type SetChatApiKeyOutput = z.infer<typeof setChatApiKeyOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 16. list_chat_members (Phase 17)
// ═══════════════════════════════════════════════════════════════════
//
// Read-only enumeration of the chat's members. Powers "kim bu
// chat'te?" answers. DM chat returns one row (the
// owner); group chat returns every member synced from Telegram
// chat_member updates.

export const listChatMembersInputSchema = z.object({});

export const listChatMembersOutputSchema = z.object({
  members: z.array(
    z.object({
      user_id: z.string().uuid(),
      telegram_username: z.string().nullable(),
      telegram_first_name: z.string(),
      joined_at: z.string().datetime({ offset: true }),
    }),
  ),
});

export type ListChatMembersInput = z.infer<typeof listChatMembersInputSchema>;
export type ListChatMembersOutput = z.infer<typeof listChatMembersOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 17b. reveal_secret (Phase 17b memory mode)
// ═══════════════════════════════════════════════════════════════════
//
// Decrypt and return a stored credential. DM-only enforced inside
// the executor — calling from a group returns a "DM-only" error. The
// LLM is instructed to call this in response to "X şifresi ne?" /
// "what's the password for X" only after locating the secret via
// search_items(kind='secret').

export const revealSecretInputSchema = z.object({
  item_id: z.string().uuid(),
});

// IMPORTANT: this output schema deliberately omits the plaintext
// value. The executor sends the value directly to the chat via the
// Telegram Bot API; only the label + suffix come back so the LLM
// can phrase its wrap-up. This keeps plaintext out of the messages
// table, the OpenRouter request payload, and our own log lines.
export const revealSecretOutputSchema = z.object({
  label: z.string(),
  suffix: z.string(),
  delivered: z.literal(true),
});

export type RevealSecretInput = z.infer<typeof revealSecretInputSchema>;
export type RevealSecretOutput = z.infer<typeof revealSecretOutputSchema>;

// ═══════════════════════════════════════════════════════════════════
// 17c. send_item_attachments (Phase 17b memory mode)
// ═══════════════════════════════════════════════════════════════════
//
// Resend every stored attachment for an item directly to the chat —
// the user gets the file(s) in Telegram, ready to view/save. Used
// when the user asks for content like "konser biletleri?" — the
// LLM locates the memory item, calls this tool, and the executor
// fires the sendPhoto/sendDocument calls server-side, returning a
// summary so the LLM can phrase the wrap-up.

export const sendItemAttachmentsInputSchema = z.object({
  item_id: z.string().uuid(),
});

export const sendItemAttachmentsOutputSchema = z.object({
  sent: z.number().int().nonnegative(),
  /** Item's text — for friendly framing in the assistant reply. */
  label: z.string(),
});

export type SendItemAttachmentsInput = z.infer<
  typeof sendItemAttachmentsInputSchema
>;
export type SendItemAttachmentsOutput = z.infer<
  typeof sendItemAttachmentsOutputSchema
>;

// ═══════════════════════════════════════════════════════════════════
// 17. get_item_by_position (Phase 17b)
// ═══════════════════════════════════════════════════════════════════
//
// Resolve "the Nth item" the user sees in /items. The /items view
// orders items by (isDone asc, position asc, createdAt asc) — this
// tool mirrors that order so a user message like "9 tamamlandı" or
// "5'i sil" can be turned into a concrete item_id by the LLM
// without resorting to fuzzy text matching.

export const getItemByPositionInputSchema = z.object({
  /** 1-based position from the /items view. */
  position: z.number().int().positive(),
});

export const getItemByPositionOutputSchema = z.object({
  item: itemSnapshotSchema.nullable(),
  /** Total open+done items in the chat (matches /items header count). */
  total: z.number().int().nonnegative(),
});

export type GetItemByPositionInput = z.infer<
  typeof getItemByPositionInputSchema
>;
export type GetItemByPositionOutput = z.infer<
  typeof getItemByPositionOutputSchema
>;

// ═══════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════

export const TOOL_NAMES = [
  "create_item",
  "search_items",
  "update_item",
  "complete_item",
  "delete_item",
  "set_deadline",
  "add_reminder",
  "remove_reminder",
  "set_item_attributes",
  "update_settings",
  "attach_file_to_item",
  "set_chat_api_key",
  "list_chat_members",
  "get_item_by_position",
  "reveal_secret",
  "send_item_attachments",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * LLM-facing tool registry consumed by `respond.ts`. Descriptions tell
 * the model when to call each tool — these are the canonical mental
 * model for the chat-only architecture.
 */
export const tools = [
  {
    name: "create_item",
    description:
      "Create a new to-do item in the CURRENT chat. Pass `text` (1-2000 chars; the item title). " +
      "Optional `description` (≤5000 chars) for long-form notes. Optional `deadline_at` (ISO 8601) — " +
      "when set, an absolute reminder is auto-created at the same moment. `is_checkable: false` " +
      "turns the item into a note (no checkbox, no deadline). " +
      "Use when the user says 'süt al' / 'add milk' / 'todo: ...' / when the message contains " +
      "concrete action items (forwards, voice transcripts). Multiple items in one user message " +
      "should be split into multiple create_item calls, not concatenated. " +
      "**Checklists / sub-items**: pass `parent_item_id` (the uuid of a top-level item in the " +
      "same chat) to nest. ONE LEVEL ONLY — the executor rejects with `no_grandchildren` if the " +
      "parent is itself nested. For todo sub-items the parent must also be a todo (no mixing " +
      "into memory trees). When the user lists ≥3 atomic actions under one umbrella " +
      "('haftalık temizlik: çamaşır, bulaşık, çöp'; 'alışveriş: süt, ekmek, yumurta'; " +
      "'tatil hazırlık: pasaport, otel, sigorta'), create the parent first, capture its id, " +
      "then create each child with `parent_item_id` set.",
    inputSchema: createItemInputSchema,
    outputSchema: createItemOutputSchema,
  },
  {
    name: "search_items",
    description:
      "Search items in the CURRENT chat. `query` ILIKEs items.text + items.description; empty query " +
      "returns the most recent items. `include_done` (default false) brings completed items into " +
      "scope; `include_archived` brings soft-deleted ones. `has_reminder: true` restricts to items " +
      "with at least one future, unsent reminder — pair with empty query for 'hangi hatırlatıcılar " +
      "var?'. `limit` 1-50 (default 20). Use this BEFORE complete_item / delete_item / update_item " +
      "when the user references items by name ('süt'ü tamamla' → search → complete with item_id). " +
      "**Nesting filter** `parent_item_id`: 'any' (default) = no filter; 'none' = top-level only " +
      "(matches /items); a uuid = children of that parent (enumerate a checklist's sub-items).",
    inputSchema: searchItemsInputSchema,
    outputSchema: searchItemsOutputSchema,
  },
  {
    name: "update_item",
    description:
      "Mutate an existing item. `item_id` is required. Mutable fields: `text`, `description` " +
      "(string|null), `deadline_at` (ISO 8601|null — null clears deadline AND drops before_deadline " +
      "reminders), `position` (drag-reorder), `pinned` (top-pin toggle), `task_recurrence_rule` " +
      "(RFC 5545 RRULE|null — non-null = auto-resurrect on complete). At least one mutable field " +
      "is required. Reminders are managed via set_deadline / add_reminder / remove_reminder; this " +
      "tool does NOT manipulate them (beyond the auto-drop on deadline=null).",
    inputSchema: updateItemInputSchema,
    outputSchema: updateItemOutputSchema,
  },
  {
    name: "complete_item",
    description:
      "Mark an item done (or undone with is_done=false). When the item has a task_recurrence_rule, " +
      "the executor CLONES it: the original is marked done (lands in /done as the audit row) and a " +
      "fresh item is inserted in /items with the same text / description / priority / tags / " +
      "reminders / attachments / recurrence rule and `deadline_at` set to the rule's next occurrence. " +
      "The warnings array carries 'task_recurred' and the `new_item` field holds the cloned row — " +
      "use it to phrase 'Tamamlandı — 🔁 yeni açıldı: <new_item.text> · <new_item.deadline>'. " +
      "Phrase normal confirmation as " +
      "'✓ <text> tamam' (TR) / '✓ <text> done' (EN). " +
      "**Checklist gate**: when the target is a top-level parent with open sub-items, the " +
      "executor returns `gate_blocked` listing the open children. Surface them to the user — " +
      "phrase: 'N alt item açık (\"x\", \"y\"). Önce onları bitirelim mi yoksa hepsini birden " +
      "tamamladım mı diyim?'. If the user says 'hepsini' / 'all done', call complete_item on " +
      "each child id first, THEN retry the parent. Completing a sub-item directly never hits " +
      "the gate.",
    inputSchema: completeItemInputSchema,
    outputSchema: completeItemOutputSchema,
  },
  {
    name: "delete_item",
    description:
      "Soft-delete an item (archived_at = now). Works on every kind — todo, memory, secret. " +
      "**TWO-STEP CONFIRMATION REQUIRED**:\n" +
      "  1. First call WITHOUT confirmed (or confirmed:false). The executor returns " +
      "`confirmation_required` and the message TEXT YOU SHOULD USE — it already mentions any " +
      "sub-items that will cascade (e.g. '\"Haftalık temizlik\" ve 3 alt item silinsin mi?'). " +
      "Echo that phrase to the user verbatim or close to it.\n" +
      "  2. ONLY after the user explicitly confirms (evet, sil, onayla, yes, delete, sure), call " +
      "delete_item again with confirmed:true. After success phrase: '🗑️ <item> silindi.' (or " +
      "'🗑️ <item> ve N alt item silindi.' when cascade happened).\n" +
      "Never skip step 1. **Cascade**: deleting a top-level parent atomically archives every " +
      "live sub-item in the same transaction. Sub-items can also be deleted individually without " +
      "touching the parent. Memory/secret items follow the same gate via the LLM path; only the " +
      "/memory and /done inline buttons can also drive it directly.",
    inputSchema: deleteItemInputSchema,
    outputSchema: deleteItemOutputSchema,
  },
  {
    name: "set_deadline",
    description:
      "Set or clear the item's deadline. `deadline_at: <ISO>` sets; `deadline_at: null` clears. " +
      "Setting auto-creates a single absolute reminder anchored at the same moment IF none exists. " +
      "Clearing also drops every before_deadline reminder (they're orphans without an anchor); " +
      "absolute reminders survive a deadline clear. Distinct from add_reminder which doesn't " +
      "touch the deadline.",
    inputSchema: setDeadlineInputSchema,
    outputSchema: setDeadlineOutputSchema,
  },
  {
    name: "add_reminder",
    description:
      "Add a reminder to an item. Pass EXACTLY ONE of:\n" +
      "  • `remind_at` (ISO 8601) — absolute moment.\n" +
      "  • `offset_minutes` — minutes BEFORE the item's deadline_at. " +
      "    If the item HAS a deadline → reminder fires at deadline - offset " +
      "    (kind=before_deadline; auto-recomputes on deadline change).\n" +
      "    If the item has NO deadline → reminder fires at NOW + offset " +
      "    (kind=absolute, fallback). Useful for 'remind me in 30 minutes' " +
      "    without forcing the user to set a deadline first.\n" +
      "Optional `recurrence_rule` (RFC 5545 RRULE) is allowed ONLY with " +
      "`remind_at`, not with `offset_minutes`. Sub-minute offsets like " +
      "'5 saniye' → offset_minutes=0 fire on the next 60-second cron tick — " +
      "that's by design, DO NOT reject as 'too short'.",
    inputSchema: addReminderInputSchema,
    outputSchema: addReminderOutputSchema,
  },
  {
    name: "remove_reminder",
    description:
      "Delete a single reminder by reminder_id. Use after surfacing the item's reminders to the " +
      "user via search_items / list_chat_members → user says 'şu hatırlatıcıyı kaldır'.",
    inputSchema: removeReminderInputSchema,
    outputSchema: removeReminderOutputSchema,
  },
  {
    name: "set_item_attributes",
    description:
      "Set status ('open'|'in_progress'|'blocked'|'done'), priority ('low'|'normal'|'high'), " +
      "and/or tags (replaces existing tags; pass [] to clear). At least one field required. " +
      "Tag limit: 20 unique tags per chat (executor rejects with `tag_limit_exceeded`). Status " +
      "='done' is equivalent to complete_item but also lets the LLM set status='in_progress' / " +
      "'blocked' which complete_item can't. " +
      "**Person assignment via tags**: there is no separate assignee field — to 'assign' an item " +
      "to someone, add a person tag (their name, lowercased, no spaces: 'michael', 'ayse'). " +
      "'ekmek işini Michael'a ata' → set_item_attributes({tags:[...existing, 'michael']}). The user " +
      "lists a person's items with the /tag <name> slash command.",
    inputSchema: setItemAttributesInputSchema,
    outputSchema: setItemAttributesOutputSchema,
  },
  {
    name: "update_settings",
    description:
      "Change the calling user's preferences. Fields: `locale` ('tr'|'en'), `timezone` (IANA " +
      "name like 'Europe/Istanbul'), `llm_model` (any OpenRouter slug, e.g. " +
      "'anthropic/claude-sonnet-4.5', 'qwen/qwen-max', 'x-ai/grok-4-fast:free' — the bot UI " +
      "shows a curated picker but users may type any slug here), " +
      "`notifications_enabled` (false → no reminder DMs), `date_format` " +
      "('DD.MM.YYYY'|'MM/DD/YYYY'|'YYYY-MM-DD'), `time_format` ('24h'|'12h'). At least one " +
      "supplied. OpenRouter API keys: use `set_chat_api_key`, NOT this tool. Output `changes` " +
      "lists fields that actually changed.",
    inputSchema: updateSettingsInputSchema,
    outputSchema: updateSettingsOutputSchema,
  },
  {
    name: "attach_file_to_item",
    description:
      "Persist a Telegram file_id reference on an item. Triggered when the user forwards a " +
      "photo / video / document / audio and says 'şu dosyayı şu item'a ekle'. The bot's " +
      "handle-message overlays [ATTACHMENT_CONTEXT: ...] on user turns carrying media — read " +
      "`file_id`, `kind`, `mime_type`, `file_size` etc. from that overlay verbatim; never " +
      "fabricate. Voice notes don't reach this path — they're STT'd into text and create_item " +
      "is called with the transcript.",
    inputSchema: attachFileToItemInputSchema,
    outputSchema: attachFileToItemOutputSchema,
  },
  {
    name: "set_chat_api_key",
    description:
      "Persist an OpenRouter API key for the CURRENT chat. OWNER-ONLY. Pass the full key in " +
      "`api_key` (starts with `sk-or-v1-`). The key is AES-256-GCM encrypted at rest and " +
      "NEVER echoed back. Side effects: user's Telegram message containing the key is auto-" +
      "deleted (DM only — bot can't delete in groups without admin) AND the key is regex-" +
      "redacted from message history before persist. Call IMMEDIATELY when the user pastes a " +
      "string starting with `sk-or-v1-`. Reply briefly with the last-4 suffix only " +
      "('✓ key kaydedildi …XXXX'); NEVER include the full key in your text response.",
    inputSchema: setChatApiKeyInputSchema,
    outputSchema: setChatApiKeyOutputSchema,
  },
  {
    name: "list_chat_members",
    description:
      "Read-only enumeration of the current chat's members. DM returns one row (the user " +
      "themselves); group returns every member synced from Telegram's chat_member updates. " +
      "Use when the user says 'kim var bu chat'te?'.",
    inputSchema: listChatMembersInputSchema,
    outputSchema: listChatMembersOutputSchema,
  },
  {
    name: "get_item_by_position",
    description:
      "Resolve the Nth item from the user's /items view. Items are ordered the SAME way /items " +
      "renders them (open items first, then position, then createdAt). " +
      "MUST be called whenever the user references an item by a bare number — e.g. '9 tamamlandı', " +
      "'5'i sil', '3'e hatırlatıcı kur', '7. işi bana ata'. Do NOT search_items by the number; do " +
      "NOT fuzzy-match. Position is 1-based. Returns {item: null, total} when N is out of range — " +
      "in that case tell the user 'sadece N item var' and stop.",
    inputSchema: getItemByPositionInputSchema,
    outputSchema: getItemByPositionOutputSchema,
  },
  {
    name: "reveal_secret",
    description:
      "Send a stored credential to the chat. DM-ONLY (executor refuses in groups). " +
      "Use this when the user asks for a saved password — e.g. 'Gmail şifresi ne?', " +
      "'what's the Wi-Fi password?'. Flow: first call search_items({kind:'secret', query: 'gmail'}) " +
      "to locate the entry, then call reveal_secret(item_id) with the resolved id. " +
      "THE EXECUTOR ITSELF SENDS THE VALUE TO THE CHAT — you never receive the plaintext. " +
      "Your reply should just confirm: \"🔒 {label} şifresini gönderdim — yukarıdaki mesaja bak. " +
      "Okuduktan sonra silmeyi unutma.\" Do NOT pretend to know the value; do NOT echo a fake " +
      "value; do NOT paste any letters or numbers from the suffix back. The actual value lives " +
      "only in the side-channel message I dispatched.",
    inputSchema: revealSecretInputSchema,
    outputSchema: revealSecretOutputSchema,
  },
  {
    name: "send_item_attachments",
    description:
      "Re-send all attachments stored on a memory/todo item directly into the chat. " +
      "Use when the user asks for the actual content of a saved item — 'konser biletleri?', " +
      "'pasaport fotoğrafı', 'göster faturayı', 'send me the boarding pass'. Flow: locate the " +
      "item with search_items (try kind='memory' first, fall back to 'any'), then call this with " +
      "item_id. The bot sends each file as a fresh message — your text reply should just frame " +
      "the result ('🎫 Konser biletini gönderdim, kolay gelsin.'). If the item has no attachments " +
      "or doesn't exist, the executor returns sent=0; tell the user there's nothing attached and " +
      "offer to attach one via /memory → 📎.",
    inputSchema: sendItemAttachmentsInputSchema,
    outputSchema: sendItemAttachmentsOutputSchema,
  },
] as const;
