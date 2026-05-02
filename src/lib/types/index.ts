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

// ─── Phase 3 additions ─────────────────────────────────────────────
//
// Phase 3 introduces three new tool surfaces (`share_list`,
// `schedule_reminder`, `assign_item`), the invite-token flow, and a
// cron-driven reminder dispatcher. The types below pin the JSON shapes
// that flow across activity_log, the invite-accept screen, the
// activity-feed API, and the cron query layer. ListRole already exists
// above — re-use, do not redeclare.

/**
 * JSON-safe snapshot of a `lists` row. Mirror of `List` with all
 * `Date` fields serialized as ISO 8601 strings.
 *
 * Used as the value type of `activity_log.payload_before` /
 * `payload_after` whenever `entity_type = 'list'` (Phase 3 actions:
 * `list_renamed`, `list_archived`, `list_restored`; Phase 4 may add
 * more). Phase 3 itself only emits `list_created` once when an invite
 * is accepted into a brand-new list — the existing `list_created`
 * action also uses this shape.
 */
export type ListSnapshot = {
  id: string;
  name: string;
  emoji: string | null;
  ownerId: string;
  isInbox: boolean;
  /** ISO 8601 string — soft-delete marker. */
  archivedAt: string | null;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
};

/**
 * JSON-safe snapshot of a `list_members` row enriched with the joined
 * user info needed for activity-feed rendering without an N+1 lookup.
 *
 * Used as the value type of `activity_log.payload_before` /
 * `payload_after` whenever `entity_type = 'member'` (Phase 3 actions:
 * `member_added`, `member_removed`, `member_role_changed`).
 *
 * `payload_before` is `null` for `member_added`; `payload_after` is
 * `null` for `member_removed`. For `member_role_changed`, both
 * snapshots are present and only `role` differs.
 */
export type MemberSnapshot = {
  id: string;
  listId: string;
  userId: string;
  role: ListRole;
  invitedBy: string | null;
  /** ISO 8601 string */
  acceptedAt: string;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
  /** Joined `users` columns — frozen at write-time so the feed renders
   *  the actor's display name even if they later change their handle. */
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

/**
 * Derived view of a `list_invites` row + the originating list's display
 * info, computed for the invite-accept screen
 * (`/app/invites/[token]/page.tsx`). The page itself is publicly
 * reachable (the invitee may not yet have a session); the API gates
 * read access via the token's entropy alone.
 *
 * `isExpired` and `isAccepted` are derived booleans the API computes so
 * the client doesn't re-derive (and disagree with) the same logic.
 */
export type InviteTokenInfo = {
  token: string;
  listId: string;
  listName: string;
  listEmoji: string | null;
  /** Display name of the user who created the invite (for "Invited by Ali"). */
  invitedByName: string;
  role: ListRole;
  /** ISO 8601 string */
  expiresAt: string;
  isExpired: boolean;
  isAccepted: boolean;
};

/**
 * Denormalized row returned by `GET /api/lists/[id]/activity` to the
 * activity-feed view (B1). One SQL query joins `activity_log` to
 * `users` (actor) so the client renders without an N+1.
 *
 * `payloadBefore` / `payloadAfter` stay `unknown` here on purpose: the
 * concrete shape is `ItemSnapshot | ListSnapshot | MemberSnapshot |
 * null` discriminated by `entityType`. Reader narrows via a switch on
 * `entityType` and casts; keeping it `unknown` at the row boundary
 * stops accidental field access on the wrong variant.
 *
 * Day grouping (sticky labels) is the Frontend's job. Activity
 * sentence localization (TR/EN) is also Frontend's job — backend
 * returns the raw `action` enum + actor name and lets the client pick
 * the localized sentence.
 */
export type ActivityFeedRow = {
  id: string;
  listId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  actorId: string;
  actorFirstName: string;
  actorUsername: string | null;
  actorPhotoUrl: string | null;
  payloadBefore: unknown;
  payloadAfter: unknown;
  /** ISO 8601 string */
  createdAt: string;
};

/**
 * Projected shape returned by the cron dispatcher's pickup query
 * (`src/lib/cron/dispatch-reminders.ts`). Stable type so the dispatcher
 * loop, the DM sender, and any future test harness all share the same
 * row contract.
 *
 * The query joins `items` → `lists` → `users` (owner via
 * `lists.owner_id`) and LEFT JOINs `users` again on `items.assignee_id`
 * to surface the assignee's Telegram chat target when present. The
 * dispatcher DMs `assigneeTelegramId` if non-null, else falls back to
 * `ownerTelegramId` (Inv-12).
 *
 * `dueAt` is ISO 8601 (UTC). All comparisons are done in UTC because
 * `items.due_at` is `timestamptz` and Dokploy cron runs in UTC; user
 * timezone is presentation-only.
 */
export type ReminderJobItem = {
  itemId: string;
  listId: string;
  text: string;
  /** ISO 8601 UTC timestamp. */
  dueAt: string;
  ownerTelegramId: number;
  ownerLocale: string;
  assigneeTelegramId: number | null;
  assigneeLocale: string | null;
};
