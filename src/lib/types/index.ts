/**
 * Architect-owned shared types. Frozen after Phase 1 except via Architect-agent invocation.
 * All entity types derived from Drizzle schema via $inferSelect / $inferInsert.
 * If a new shared type is needed, request via the agent contract — never declare equivalents elsewhere.
 */
import type {
  activityLog,
  items,
  listInvites,
  listMembers,
  lists,
  messages,
  users,
} from "@/lib/db/schema";

// ─── User ───────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── List ───────────────────────────────────────────────────────────
export type List = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;

// ─── ListMember ─────────────────────────────────────────────────────
export type ListMember = typeof listMembers.$inferSelect;
export type NewListMember = typeof listMembers.$inferInsert;
export type ListRole = "owner" | "editor" | "viewer";

// ─── Item ───────────────────────────────────────────────────────────
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

// ─── Message (LLM conversation) ─────────────────────────────────────
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageRole = "user" | "assistant" | "tool";

// ─── ListInvite ─────────────────────────────────────────────────────
export type ListInvite = typeof listInvites.$inferSelect;
export type NewListInvite = typeof listInvites.$inferInsert;

// ─── ActivityLog ────────────────────────────────────────────────────
export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
export type ActivityEntityType = "item" | "list" | "member";
export type ActivityAction =
  | "item_created"
  | "item_completed"
  | "item_uncompleted"
  | "item_edited"
  | "item_deleted"
  | "item_assigned"
  | "item_unassigned"
  | "item_due_set"
  | "item_due_cleared"
  | "list_created"
  | "list_renamed"
  | "list_archived"
  | "list_restored"
  | "member_added"
  | "member_removed"
  | "member_role_changed";

// ─── Generic API envelope ───────────────────────────────────────────
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: { code: string; message: string };
};
export type ApiResult<T> = ApiOk<T> | ApiErr;

// ─── LLM tool calling primitives ────────────────────────────────────
//
// Mirror the Anthropic / OpenRouter tool-calling shape and the JSONB
// schema of `messages.tool_calls` / `messages.tool_call_id`. AI-agent
// (`src/lib/ai/**`) and Backend-agent (`src/lib/server/**`) both consume
// these — the contract is intentionally provider-neutral.

/**
 * One assistant tool invocation. Stored as an element of
 * `messages.tool_calls` (jsonb) when role='assistant'.
 *
 * `id` is the provider-issued opaque id; backend echoes it back as
 * `ToolResult.toolCallId` when persisting the corresponding tool message.
 *
 * `input` is `unknown` at the boundary; each executor zod-parses it
 * against the tool's input schema before doing any work.
 */
export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
};

/**
 * One tool execution result. Persisted as a single message row with
 * role='tool', `tool_call_id` = the originating ToolCall.id, and
 * `content` = JSON.stringify(output).
 */
export type ToolResult = {
  toolCallId: string;
  output: unknown;
};

/**
 * Discriminated union over the three message roles for in-memory LLM
 * orchestration. NOT a DB row — see `MessageWithToolCalls` for that.
 *
 * - 'user' / 'assistant' (no tool_calls): plain text content
 * - 'assistant' with tool_calls: model wants to invoke tools; content
 *   may be empty string (some providers omit reasoning)
 * - 'tool': result message; toolCallId references the assistant's call
 */
export type ConversationMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/**
 * DB row type for `messages` with the jsonb `tool_calls` column parsed
 * into `ToolCall[] | null`. Use this in queries that hand rows to the
 * AI orchestrator; raw `Message` keeps `tool_calls: unknown` from
 * Drizzle's jsonb inference and forces casts at every consumer.
 */
export type MessageWithToolCalls = Omit<Message, "toolCalls"> & {
  toolCalls: ToolCall[] | null;
};

// ─── Activity log payload snapshots ─────────────────────────────────
//
// `activity_log.payload_before` / `payload_after` are JSONB. JSON has
// no Date type, so dates round-trip as ISO strings. These types fix
// the on-disk shape so F2 audit/restore (Phase 4) can deserialize
// without guessing.
//
// Convention: omit `created_at`/`updated_at` from the snapshot when
// they're not meaningful for the diff (kept here for completeness so a
// restore can reconstruct the full row).

/**
 * JSON-safe snapshot of an `items` row. Mirror of `Item` with all
 * `Date` fields serialized as ISO 8601 strings.
 *
 * Used as the value type of `activity_log.payload_before` and
 * `payload_after` whenever `entity_type = 'item'`.
 */
export type ItemSnapshot = {
  id: string;
  listId: string;
  text: string;
  isCheckable: boolean;
  isDone: boolean;
  assigneeId: string | null;
  /** ISO 8601 string, e.g. "2026-05-01T18:00:00.000Z" */
  dueAt: string | null;
  reminderSent: boolean;
  position: number;
  createdBy: string;
  /** ISO 8601 string */
  completedAt: string | null;
  /** ISO 8601 string — soft-delete marker */
  archivedAt: string | null;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
};
