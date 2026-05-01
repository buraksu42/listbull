import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
    openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
    llmModel: text("llm_model").notNull().default("anthropic/claude-sonnet-4"),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_telegram_username_idx").on(sql`lower(${t.telegramUsername})`),
  ],
);

// ─── lists ─────────────────────────────────────────────────────────
export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isInbox: boolean("is_inbox").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("lists_owner_id_idx").on(t.ownerId),
    uniqueIndex("lists_owner_inbox_unique")
      .on(t.ownerId)
      .where(sql`${t.isInbox} = true`),
  ],
);

// ─── list_members ──────────────────────────────────────────────────
export const listMembers = pgTable(
  "list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Enum-via-check at app layer: 'owner' | 'editor' | 'viewer'
    role: text("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("list_members_list_user_unique").on(t.listId, t.userId),
    index("list_members_user_id_idx").on(t.userId),
  ],
);

// ─── items ─────────────────────────────────────────────────────────
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    isCheckable: boolean("is_checkable").notNull().default(true),
    isDone: boolean("is_done").notNull().default(false),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    reminderSent: boolean("reminder_sent").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("items_list_id_idx").on(t.listId, t.archivedAt, t.isDone, t.position),
    index("items_due_at_idx")
      .on(t.dueAt)
      .where(sql`${t.dueAt} is not null and ${t.reminderSent} = false`),
    index("items_assignee_idx").on(t.assigneeId, t.isDone),
  ],
);

// ─── messages (LLM conversation history) ───────────────────────────
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

// ─── list_invites ──────────────────────────────────────────────────
export const listInvites = pgTable(
  "list_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    invitedUsername: text("invited_username").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    role: text("role").notNull().default("editor"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("list_invites_token_idx").on(t.token),
    index("list_invites_list_idx").on(t.listId),
  ],
);

// ─── activity_log (dual-purpose: feed + audit/restore) ─────────────
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "cascade" }),
    // 'item' | 'list' | 'member'
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
    index("activity_list_recent_idx").on(t.listId, sql`${t.createdAt} desc`),
    index("activity_entity_idx").on(
      t.entityType,
      t.entityId,
      sql`${t.createdAt} desc`,
    ),
  ],
);
