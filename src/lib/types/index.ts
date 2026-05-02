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

// ─── Phase 4 additions (FROZEN after Phase 4 — Phase 5 is launch only) ─
//
// Phase 4 ships the OSS-quality features: A3 forwarded messages, D1
// inline mode, D2 shareable list snapshot, D3 docs-only, F1 export, F2
// audit/restore, E1/E2/E3 i18n + a11y. The types below pin the JSON
// shapes that flow across the snapshot page, the export download, the
// audit/restore UI, and the inline-query result list. After this phase,
// `src/lib/types/index.ts` is FROZEN — Phase 5 (launch prep) does not
// alter the type surface.

/**
 * Public read-only snapshot of a list (D2). Generated on-the-fly from
 * the list's current state at request time — no DB column stores
 * snapshots. Expiration is URL-bound via a signed query parameter, not
 * DB-tracked, which keeps the schema frozen.
 *
 * Consumed by `src/app/(marketing)/snapshot/[id]/page.tsx`. The URL
 * carries `?token=<base64url(hmac)>` + `?exp=<unix-ms>`; the page
 * verifies HMAC-SHA256 against `ENV_KEY` (or a dedicated
 * `SNAPSHOT_SIGNING_KEY` if Backend chooses) and rejects expired or
 * tampered requests.
 *
 * Excludes: assignees, due dates, members, activity. The snapshot is a
 * forwardable read-only artifact, not a fully-functional list view.
 */
export type SnapshotPublic = {
  listId: string;
  listName: string;
  listEmoji: string | null;
  /** ISO 8601 — when the snapshot was generated. */
  capturedAt: string;
  /** ISO 8601 — when the signed URL expires (default capturedAt + 30 days). */
  expiresAt: string;
  items: Array<{
    text: string;
    isDone: boolean;
    /** ISO 8601 or null — only the date is shown to viewers; assignee not exposed. */
    dueAt: string | null;
  }>;
  /** Owner's display first-name only — no username or photo (light privacy). */
  ownerFirstName: string;
};

/**
 * Full data export bundle (F1). Returned by `GET /api/settings/export`
 * (caller is the user being exported — never another user's data).
 *
 * Excludes per spec: other users' data (only items in lists the caller
 * OWNS or co-edits where the caller created them are included), the
 * encrypted OpenRouter API key, the user's session cookies. `messages`
 * are caller-only by `(user_id)` filter.
 *
 * Delivery shape: served as `application/json` directly from the route
 * (Phase 4 default). If a backing store path emerges later, switch to
 * a 24h signed Hetzner Object Storage URL — the bundle shape stays the
 * same.
 */
export type ExportBundle = {
  /** ISO 8601 — when the bundle was generated. */
  generatedAt: string;
  user: {
    telegramId: number;
    locale: string;
    timezone: string;
  };
  lists: ListSnapshot[];
  items: ItemSnapshot[];
  activity: ActivityFeedRow[];
  messages: Array<{
    role: MessageRole;
    content: string;
    /** ISO 8601 string. */
    createdAt: string;
  }>;
};

/**
 * Audit-feed row enriched with a derived `canRestore` boolean (F2). The
 * audit page (`(app)/lists/[id]/audit`) consumes `ActivityFeedRow`
 * unchanged plus this view-model for the per-row Restore button.
 *
 * `canRestore = (action === "item_deleted" AND createdAt > now() - 30d)`.
 * Phase 4 backend computes the boolean server-side so client and server
 * never disagree; the 30-day window is enforced again in
 * `POST /api/lists/[id]/restore` for defense-in-depth.
 */
export type AuditEntryWithRestore = ActivityFeedRow & {
  canRestore: boolean;
};

/**
 * One inline-query result row (D1). Bot inline mode lets users type
 * `@listgram_bot <query>` in any chat to surface item suggestions.
 * Telegram caps results at 50; per the open question resolution
 * (handoff/specs/CLAUDE.md), Phase 4 returns up to 10 most-recent
 * matching items across the user's lists (no LLM ranking — instant
 * surface, deterministic).
 *
 * `deeplink` opens the Mini App at the list containing the item:
 * `https://t.me/<bot>?startapp=item_<itemId>`. Tap action resolved
 * during Phase 4 implementation; spec is "open Mini App at the item".
 */
export type InlineQueryResult = {
  id: string;
  type: "article";
  /** Shown as the bold first line — the item text. */
  title: string;
  /** Shown below the title — list emoji + name + done state. */
  description: string;
  /** Mini App deeplink. */
  deeplink: string;
  /** Optional list emoji rendered as the result's thumbnail. */
  thumbUrl?: string;
};

/**
 * Sentinel type for next-intl message catalogs. The catalog shape is
 * deep nested key-value pairs; we type it loosely at the boundary
 * (next-intl provides its own narrower types per-namespace via
 * generation). Use this where a catalog is passed around opaquely.
 *
 * `messages/{tr,en}.json` are the on-disk canonical sources.
 */
export type LocaleMessages = Record<string, unknown>;
