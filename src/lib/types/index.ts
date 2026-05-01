/**
 * Architect-owned shared types. Frozen after Phase 1.
 * All types derived from Drizzle schema via $inferSelect / $inferInsert.
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
