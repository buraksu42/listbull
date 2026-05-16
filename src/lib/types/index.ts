/**
 * Phase 17 chat-only pivot — shared types.
 *
 * Workspace + list + sharing concepts removed; the surface is now:
 *   - User, Chat, ChatMember
 *   - Item + Reminder + Attachment (chat-scoped)
 *   - ActivityLog (chat-scoped)
 *   - Message (LLM history)
 *   - LLM tool-calling primitives
 *
 * Derived from Drizzle schema via $inferSelect / $inferInsert.
 */
import type {
  activityLog,
  chatMembers,
  chats,
  itemAttachments,
  itemReminders,
  items,
  messages,
  users,
} from "@/lib/db/schema";

// ─── User ───────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── Chat (Phase 17) ────────────────────────────────────────────────
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatType = "private" | "group" | "supergroup";

// ─── ChatMember (Phase 17) ──────────────────────────────────────────
export type ChatMember = typeof chatMembers.$inferSelect;
export type NewChatMember = typeof chatMembers.$inferInsert;

// ─── Item ───────────────────────────────────────────────────────────
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

// ─── ItemReminder ───────────────────────────────────────────────────
export type ItemReminder = typeof itemReminders.$inferSelect;
export type NewItemReminder = typeof itemReminders.$inferInsert;
export type ItemReminderKind = "absolute" | "before_deadline";

// ─── ItemAttachment ─────────────────────────────────────────────────
export type ItemAttachment = typeof itemAttachments.$inferSelect;
export type NewItemAttachment = typeof itemAttachments.$inferInsert;
export type AttachmentKind =
  | "photo"
  | "video"
  | "document"
  | "audio"
  | "voice"
  | "video_note";

// ─── Message ────────────────────────────────────────────────────────
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageRole = "user" | "assistant" | "tool";

// ─── ActivityLog (Phase 17 — chat-scoped) ───────────────────────────
export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
export type ActivityEntityType = "item" | "chat" | "member";
export type ActivityAction =
  | "item_created"
  | "item_completed"
  | "item_uncompleted"
  | "item_edited"
  | "item_deleted"
  | "item_assigned"
  | "item_unassigned"
  | "item_deadline_set"
  | "item_deadline_cleared"
  | "item_reminder_added"
  | "item_reminder_removed"
  | "item_reminder_fired"
  | "item_attachment_added"
  | "item_attachment_removed"
  | "chat_created"
  | "chat_api_key_set"
  | "member_added"
  | "member_removed";

// ─── Generic API envelope ───────────────────────────────────────────
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = {
  ok: false;
  error: { code: string; message: string };
};
export type ApiResult<T> = ApiOk<T> | ApiErr;

// ─── LLM tool calling primitives ────────────────────────────────────

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type ToolResult = {
  toolCallId: string;
  output: unknown;
};

export type ConversationMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type MessageWithToolCalls = Omit<Message, "toolCalls"> & {
  toolCalls: ToolCall[] | null;
};

// ─── Activity log payload snapshots (chat-scoped) ───────────────────

/** 'todo' | 'memory' | 'secret' — items.kind discriminator. */
export type ItemKind = "todo" | "memory" | "secret";

/** JSON-safe snapshot of an `items` row. */
export type ItemSnapshot = {
  id: string;
  chatId: number;
  text: string;
  description: string | null;
  isCheckable: boolean;
  isDone: boolean;
  status: string;
  priority: string;
  tags: string[];
  assigneeId: string | null;
  deadlineAt: string | null;
  pinnedAt: string | null;
  taskRecurrenceRule: string | null;
  position: number;
  createdBy: string;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 'todo' | 'memory' | 'secret' — discriminator. */
  kind: ItemKind;
  /** Nested-item parent; null for top-level. */
  parentItemId: string | null;
};

/** JSON-safe snapshot of an `item_reminders` row. */
export type ItemReminderSnapshot = {
  id: string;
  itemId: string;
  remindAt: string;
  kind: ItemReminderKind;
  offsetMinutes: number | null;
  recurrenceRule: string | null;
  sent: boolean;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** JSON-safe snapshot of an `item_attachments` row. */
export type AttachmentSnapshot = {
  id: string;
  itemId: string;
  chatId: number;
  kind: AttachmentKind;
  mimeType: string | null;
  fileSize: number | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  originalFilename: string | null;
  uploadedByUserId: string;
  createdAt: string;
};

// ─── Cron reminder dispatcher pickup row ────────────────────────────
//
// Phase 17: chat-scoped. items.chat_id → chats.owner_user_id resolves
// the bot DM target when the assignee falls back. White-label bots
// dropped; default platform bot serves all reminders.
export type ReminderJobItem = {
  reminderId: string;
  itemId: string;
  chatId: number;
  text: string;
  remindAt: string;
  deadlineAt: string | null;
  kind: ItemReminderKind;
  offsetMinutes: number | null;
  recurrenceRule: string | null;
  /** Chat owner's Telegram ID — fallback target when assignee is null. */
  ownerTelegramId: number;
  ownerLocale: string;
  ownerTimezone: string;
  assigneeTelegramId: number | null;
  assigneeLocale: string | null;
  assigneeTimezone: string | null;
};

/** Sentinel for next-intl message catalogs. */
export type LocaleMessages = Record<string, unknown>;
