import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

// ─── users ─────────────────────────────────────────────────────────
//
// Phase 17 (chat-only pivot): `active_workspace_id` removed. Each
// Telegram chat (DM or group) is its own context — see `chats` below.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    telegramUsername: text("telegram_username"),
    telegramFirstName: text("telegram_first_name").notNull(),
    telegramLastName: text("telegram_last_name"),
    telegramPhotoUrl: text("telegram_photo_url"),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("UTC"),
    /**
     * Phase 14c: per-user display preferences. App-layer enums (no DB
     * CHECK constraint) — values: dateFormat ∈ {'DD.MM.YYYY',
     * 'MM/DD/YYYY', 'YYYY-MM-DD'}, timeFormat ∈ {'24h', '12h'}.
     */
    dateFormat: text("date_format").notNull().default("DD.MM.YYYY"),
    timeFormat: text("time_format").notNull().default("24h"),
    /**
     * Phase 17: user-level LLM model preference. Used by the bot when
     * no per-chat override exists (chats.llm_model). Kept for backward
     * compat with the per-user picker that shipped pre-pivot.
     */
    llmModel: text("llm_model").notNull().default("google/gemini-2.5-flash"),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    /**
     * Phase 15: idempotency marker for the 09:00 daily digest cron.
     * Stored as `date` (not `timestamptz`) — the only question we ask
     * is "did we already send the digest for today's user-local
     * date?". Pickup query stores the date in the user's own timezone
     * so cron-tick drift across UTC midnight doesn't cause a re-send.
     */
    dailyDigestSentOn: date("daily_digest_sent_on"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_telegram_username_idx").on(sql`lower(${t.telegramUsername})`),
    index("users_digest_pickup_idx")
      .on(t.notificationsEnabled, t.dailyDigestSentOn)
      .where(sql`${t.notificationsEnabled} = true`),
  ],
);

// ─── chats (Phase 17: chat-only pivot) ─────────────────────────────
//
// Replaces the workspaces+lists hierarchy. ONE chat = ONE list. The
// chat_id is Telegram's native id (negative bigint for groups,
// positive for DMs). Items, activity_log, attachments all reference
// chat_id directly. No "active chat" concept — context is the chat
// the message arrived in.
//
// Owner = whoever the bot DM's about the chat's setup (DM: the user
// themselves; group: whoever added the bot per `my_chat_member.from`).
// Only owner can set / rotate the OpenRouter API key.
export const chats = pgTable(
  "chats",
  {
    chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
    /** 'private' | 'group' | 'supergroup' — app-layer enum. */
    type: text("type").notNull(),
    /** Group title, null for DM. */
    title: text("title"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Per-chat OpenRouter API key, AES-256-GCM at rest via ENV_KEY.
     * Set by the owner via chat-paste or /key command.
     */
    openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
    /** Owner-only setting: which LLM model the bot uses in this chat. */
    llmModel: text("llm_model").notNull().default("google/gemini-2.5-flash"),
    /**
     * Idempotency marker for the chat-level 09:00 daily digest push.
     * Stored as `date` in owner's TZ — same pattern as
     * `users.daily_digest_sent_on`.
     */
    lastDailyPushOn: date("last_daily_push_on"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("chats_owner_idx").on(t.ownerUserId),
  ],
);

// ─── chat_members (Phase 17) ───────────────────────────────────────
//
// Auto-populated from Telegram's `chat_member` updates (new user
// joined, left, kicked). Mirrors group membership so the assignee
// picker + activity-feed-by-actor surfaces can resolve user identity
// without round-tripping Telegram on every read.
//
// For DM chats: a single row (chat owner is the only member).
export const chatMembers = pgTable(
  "chat_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_members_chat_user_uq").on(t.chatId, t.userId),
    index("chat_members_user_idx").on(t.userId),
  ],
);

// ─── items ─────────────────────────────────────────────────────────
//
// Phase 17: list_id removed. Items belong directly to a `chats` row.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /**
     * Phase 14a: optional long-form context (≤5000 chars). Distinct
     * from `text` (the title) — the LLM is instructed to use this for
     * notes, links, and multi-line bodies, not for summaries.
     */
    description: text("description"),
    isCheckable: boolean("is_checkable").notNull().default(true),
    isDone: boolean("is_done").notNull().default(false),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * The moment the item is due. Distinct from reminders — reminders
     * are scheduled in the sibling `item_reminders` table. May be null
     * when an item has reminders that aren't anchored to a deadline.
     */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    /** Pin-to-top timestamp. NULL = not pinned. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /**
     * Task-level RFC 5545 RRULE. When set, completing the item does
     * NOT permanently mark it done — instead, complete-item advances
     * the deadline (if present) by the rule's next occurrence and
     * resets `is_done=false`, `status='open'`, `completed_at=null`.
     */
    taskRecurrenceRule: text("task_recurrence_rule"),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("items_chat_idx").on(t.chatId, t.archivedAt, t.isDone, t.position),
    index("items_deadline_at_idx")
      .on(t.deadlineAt)
      .where(sql`${t.deadlineAt} is not null and ${t.archivedAt} is null`),
    index("items_assignee_idx").on(t.assigneeId, t.isDone),
    index("items_status_idx").on(t.chatId, t.status),
    index("items_tags_gin").using("gin", t.tags),
  ],
);

// ─── item_reminders (Phase 14d, unchanged in Phase 17) ─────────────
export const itemReminders = pgTable(
  "item_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** 'absolute' | 'before_deadline' */
    kind: text("kind").notNull(),
    /**
     * For kind='absolute': the moment to fire (may be in the past for
     * one-shot reminders that already fired). For kind='before_deadline':
     * computed = items.deadline_at - offset_minutes; recomputed when
     * deadline changes (see recomputeOffsetReminders).
     */
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    /** kind='before_deadline' only. Minutes BEFORE items.deadline_at. */
    offsetMinutes: integer("offset_minutes"),
    /** kind='absolute' only. RFC 5545 RRULE for repeat reminders. */
    recurrenceRule: text("recurrence_rule"),
    /** Flips true after a successful Telegram DM. */
    sent: boolean("sent").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("item_reminders_due_idx")
      .on(t.remindAt)
      .where(sql`${t.sent} = false`),
    index("item_reminders_item_idx").on(t.itemId),
  ],
);

// ─── item_attachments (Phase 14b, chat_id pivot in Phase 17) ───────
export const itemAttachments = pgTable(
  "item_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    chatId: bigint("chat_id", { mode: "number" })
      .notNull()
      .references(() => chats.chatId, { onDelete: "cascade" }),
    /**
     * Telegram message field that produced this row:
     * 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'video_note'.
     * App-layer enum; no DB CHECK constraint.
     */
    kind: text("kind").notNull(),
    /** Bot-scoped file id; rotates with the bot token. */
    telegramFileId: text("telegram_file_id").notNull(),
    /** Bot-stable cross-bot id; used to dedupe within an item. */
    telegramFileUniqueId: text("telegram_file_unique_id"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }),
    durationSeconds: integer("duration_seconds"),
    width: integer("width"),
    height: integer("height"),
    /** Telegram-provided thumbnail file_id (videos / documents). */
    thumbnailFileId: text("thumbnail_file_id"),
    originalFilename: text("original_filename"),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("item_attachments_item_idx").on(t.itemId),
    uniqueIndex("item_attachments_telegram_unique_idx")
      .on(t.itemId, t.telegramFileUniqueId)
      .where(sql`${t.telegramFileUniqueId} is not null`),
  ],
);

// ─── messages (LLM conversation history) ───────────────────────────
//
// Already chat-id native — no Phase 17 changes beyond adding the FK
// to `chats.chat_id` for cascade-on-archive cleanliness.
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    // 'user' | 'assistant' | 'tool'
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    toolCallId: text("tool_call_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_chat_recent_idx").on(
      t.userId,
      t.chatId,
      sql`${t.createdAt} desc`,
    ),
  ],
);

// ─── activity_log (dual-purpose: feed + audit/restore) ─────────────
//
// Phase 17: list_id → chat_id swap. Activity is per-chat now.
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: bigint("chat_id", { mode: "number" })
      .references(() => chats.chatId, { onDelete: "cascade" }),
    // 'item' | 'chat' | 'member'
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    // See action enumeration in handoff/specs/architecture.md
    action: text("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    payloadBefore: jsonb("payload_before"),
    payloadAfter: jsonb("payload_after"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activity_chat_recent_idx").on(t.chatId, sql`${t.createdAt} desc`),
    index("activity_entity_idx").on(
      t.entityType,
      t.entityId,
      sql`${t.createdAt} desc`,
    ),
  ],
);
