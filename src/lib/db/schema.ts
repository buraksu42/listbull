import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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
// Phase 4.5 adds `active_workspace_id` — the user's currently-selected
// workspace. Resolved per `docs/architecture-pass-phase-4.5.md`'s
// "Workspace context resolution contract": Mini App ?workspace= query
// param > cookie > this column > Personal Workspace fallback.
//
// Nullable because at user-creation time the Personal Workspace
// doesn't yet exist (resolved transactionally on /start).
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
     * Defaults are TR-friendly; the migration backfills EN-locale
     * rows to MM/DD/YYYY + 12h, and the user-creation flow picks a
     * smart default based on `locale`.
     */
    dateFormat: text("date_format").notNull().default("DD.MM.YYYY"),
    timeFormat: text("time_format").notNull().default("24h"),
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
    activeWorkspaceId: uuid("active_workspace_id").references(
      (): AnyPgColumn => workspaces.id,
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_telegram_username_idx").on(sql`lower(${t.telegramUsername})`),
    // Phase 15 daily digest pickup — only candidates that opted into
    // notifications are scanned; the column is null for never-sent.
    index("users_digest_pickup_idx")
      .on(t.notificationsEnabled, t.dailyDigestSentOn)
      .where(sql`${t.notificationsEnabled} = true`),
  ],
);

// ─── lists ─────────────────────────────────────────────────────────
//
// Phase 4.5: `workspace_id` becomes the access-control axis. Workspace
// membership (via `workspace_members`) controls who can see + edit the
// list. `owner_id` stays as the user who created the list (audit + UI
// "created by Ali") but no longer governs access. Inbox is now a
// workspace-level concept (one Inbox per workspace, not per user) —
// the partial unique index moves accordingly.
export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    emoji: text("emoji"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references((): AnyPgColumn => workspaces.id, { onDelete: "cascade" }),
    isInbox: boolean("is_inbox").notNull().default(false),
    /**
     * Phase 16 (checklists): when true, the list represents a
     * repeatable process. The Mini App renders simplified rows
     * (checkbox + text only — description/deadline/tag hidden) and
     * exposes "start new run" / "complete run" actions. Run history
     * lives in `list_runs`. Item rows are NOT duplicated per run;
     * "start new run" resets every item's status to 'open' and logs
     * a `list_runs` row capturing pre-reset completion stats.
     */
    isChecklist: boolean("is_checklist").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("lists_owner_id_idx").on(t.ownerId),
    index("lists_workspace_id_idx").on(t.workspaceId, t.archivedAt),
    uniqueIndex("lists_workspace_inbox_unique")
      .on(t.workspaceId)
      .where(sql`${t.isInbox} = true`),
  ],
);

// ─── list_runs (Phase 16, checklists) ───────────────────────────────
//
// One row per "run" of a checklist list. A run starts when the user
// (or LLM via `start_checklist_run`) opens a new pass over the
// checklist, and completes either explicitly (`complete_checklist_run`)
// or implicitly (the next `start_checklist_run` auto-completes the
// previous open run before opening a new one).
//
// Stats snapshot captures completion at the moment of run-end so the
// run-history feed renders meaningful numbers without re-deriving
// from activity_log. Item rows themselves are NOT copied per run —
// they're shared physical rows, reset on each new run.
export const listRuns = pgTable(
  "list_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    completedByUserId: uuid("completed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /** Active item count at run start (snapshot — never updated). */
    itemsTotal: integer("items_total").notNull().default(0),
    /** is_done count when the run was closed; null while still open. */
    itemsCompleted: integer("items_completed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // History feed: most recent run first per list.
    index("list_runs_list_recent_idx").on(
      t.listId,
      sql`${t.startedAt} desc`,
    ),
    // At most one open run per list at a time. Enforced as a unique
    // partial index instead of an app-layer constraint so concurrent
    // double-clicks on "start run" can't race.
    uniqueIndex("list_runs_active_per_list_uq")
      .on(t.listId)
      .where(sql`${t.completedAt} is null`),
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
//
// Phase 4.5 adds three discipline columns:
//   - status:    'open' | 'in_progress' | 'blocked' | 'done'
//   - priority:  'low' | 'normal' | 'high'
//   - tags:      text[] (workspace-scoped vocabulary, max 20 unique
//                tags per workspace enforced in `set_item_attributes`)
//
// Phase 14d split deadlines from reminders:
//   - `due_at` renamed to `deadline_at` — the moment the work is due.
//   - `reminder_sent` dropped — moved to `item_reminders.sent` (1-to-N).
//   - `recurrence_rule` dropped — moved to `item_reminders.recurrence_rule`
//     (recurrence is a property of the reminder, not the deadline).
//
// `is_done` STAYS for backward compat. Treated as derived from
// `status` (`is_done = (status = 'done')`); writes touch both columns
// so existing executors keep reading `is_done` while the LLM and new
// surfaces operate on `status`. Drop deferred to Phase 5+ with full
// executor audit.
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
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
    /**
     * Pin-to-top timestamp. NULL = not pinned. Non-null pins the item
     * to the top of its list, sorted by `pinned_at DESC` (most recent
     * pin first) — independent from priority. Toggle via the row pin
     * button or `update_item.pinned`.
     */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    /**
     * Task-level RFC 5545 RRULE. When set, completing the item does
     * NOT permanently mark it done — instead, complete-item advances
     * the deadline (if present) by the rule's next occurrence and
     * resets `is_done=false`, `status='open'`, `completed_at=null`.
     * Distinct from `item_reminders.recurrence_rule` which only re-
     * fires reminder pings without resurrecting the task. Common
     * use: "her hafta perşembe" weekly chores.
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
    index("items_list_id_idx").on(t.listId, t.archivedAt, t.isDone, t.position),
    index("items_deadline_at_idx")
      .on(t.deadlineAt)
      .where(sql`${t.deadlineAt} is not null and ${t.archivedAt} is null`),
    index("items_assignee_idx").on(t.assigneeId, t.isDone),
    index("items_status_idx").on(t.listId, t.status),
    index("items_tags_gin").using("gin", t.tags),
  ],
);

// ─── item_reminders (Phase 14d) ─────────────────────────────────────
//
// One-to-many child of `items`. Replaces the conflated `items.due_at` /
// `items.reminder_sent` / `items.recurrence_rule` triplet with explicit
// reminder rows. An item can have zero, one, or many reminders.
//
// Two reminder kinds:
//   - 'absolute': fires at `remind_at` (an explicit moment). Optional
//     RRULE re-arms the reminder after each fire.
//   - 'before_deadline': anchored to `items.deadline_at` minus
//     `offset_minutes`. When the deadline moves, every offset-anchored
//     reminder for that item is recomputed in lock-step (see
//     `recomputeOffsetReminders` in `_shared.ts`). Recurrence is not
//     allowed for this kind — use 'absolute' + RRULE for recurring
//     offset patterns.
//
// CHECK constraints enforce the kind/offset/recurrence pairing at the
// DB layer so half-applied state from buggy executors can't slip in.
export const itemReminders = pgTable(
  "item_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /**
     * The concrete moment to fire. For 'absolute' kind this is user-set.
     * For 'before_deadline' kind this is computed
     * (= items.deadline_at - offset_minutes) and recomputed whenever
     * the deadline moves.
     */
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    /** 'absolute' | 'before_deadline'. */
    kind: text("kind").notNull().default("absolute"),
    /**
     * Populated only when kind='before_deadline'. The number of minutes
     * before `items.deadline_at` to fire. CHECK constraint enforces the
     * kind/offset pairing.
     */
    offsetMinutes: integer("offset_minutes"),
    /**
     * Optional RFC 5545 RRULE body (no 'RRULE:' prefix, no DTSTART).
     * Only allowed when kind='absolute'. Times are interpreted in UTC
     * (LLM converts to user's timezone when phrasing back). When a
     * reminder fires and this column is non-null, the dispatcher
     * computes the next occurrence and resets `remind_at` + `sent` to
     * re-arm.
     *
     * Example: `FREQ=WEEKLY;BYDAY=WE;BYHOUR=18;BYMINUTE=0` —
     * "every Wednesday at 18:00 UTC".
     */
    recurrenceRule: text("recurrence_rule"),
    sent: boolean("sent").notNull().default(false),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Cron pickup: only unsent reminders, ordered by fire time.
    index("item_reminders_due_idx")
      .on(t.remindAt)
      .where(sql`${t.sent} = false`),
    // For "list reminders for this item" + cascade joins.
    index("item_reminders_item_idx").on(t.itemId),
  ],
);

// CHECK constraints for item_reminders are emitted by the migration as
// raw SQL — Drizzle doesn't yet have first-class tableCheck support in
// our version. The migration file enforces:
//   - kind IN ('absolute', 'before_deadline')
//   - (kind='before_deadline' AND offset_minutes IS NOT NULL AND offset_minutes >= 0)
//     OR (kind='absolute' AND offset_minutes IS NULL)
//   - recurrence_rule IS NULL OR kind='absolute'

// ─── item_attachments (Phase 14b) ───────────────────────────────────
//
// One-to-many child of `items`. Hybrid storage strategy:
//
//   1. Hot path: `telegram_file_id` — Telegram CDN serves bytes for
//      free, instantly. Bot intake stores the largest size variant
//      for photos.
//   2. Backup: a 5-minute-tick cron downloads via `bot.api` and
//      uploads to Hetzner Object Storage at
//      `attachments/{workspace_id}/{item_id}/{attachment_id}.{ext}`,
//      then sets `storage_key` + `storage_backed_up_at`. Survives
//      bot token rotation (which invalidates every Telegram file_id).
//   3. Read fallback: when the Telegram CDN URL fails, the proxy
//      route falls back to a Hetzner pre-signed GET.
//
// 20MB cap: `bot.api.downloadFile` can't pull files >20MB. Larger
// attachments stay Telegram-only (UI shows a "no permanent backup"
// badge). `backup_skipped_reason` is reserved for that follow-up.
//
// `workspace_id` is denormalized (instead of joining items → lists →
// workspaces) so the storage path can be computed without an extra
// query and so cascade-delete-by-workspace is one fk hop.
export const itemAttachments = pgTable(
  "item_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references((): AnyPgColumn => workspaces.id, { onDelete: "cascade" }),
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
    // Dedup: same (item, telegram_file_unique_id) pair → upsert.
    uniqueIndex("item_attachments_telegram_unique_idx")
      .on(t.itemId, t.telegramFileUniqueId)
      .where(sql`${t.telegramFileUniqueId} is not null`),
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

// ═══════════════════════════════════════════════════════════════════
// Phase 4.5 — Workspace + Billing + Multi-Bot scaffolding
//
// Spec: docs/architecture-pass-phase-4.5.md
// Migration runbook: § "Migration runbook (single transactional script)"
// ═══════════════════════════════════════════════════════════════════

// ─── workspaces ────────────────────────────────────────────────────
//
// One Personal Workspace auto-created per user on /start (or
// backfilled in the Phase 4.5 migration). Team / Workspace tier
// users may own additional workspaces up to their tier's
// `workspaceCount` (TIER_LIMITS in src/lib/types/billing.ts).
//
// `member_limit` is denormalized from the tier for fast tier-check
// reads — Billing's webhook handler refreshes it inside the same
// transaction that updates `subscriptions.tier`.
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isPersonal: boolean("is_personal").notNull().default(false),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Workspace-level OpenRouter org-key. Members without a personal
     * BYOK fall back to this key for LLM calls. Encrypted via the
     * same AES-256-GCM helper as user BYOK. Set via the workspace
     * settings org-key form.
     */
    openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
    /**
     * Workspace-scoped LLM model — owner-only setting. Every member of
     * the workspace uses this model for their bot turns. Was per-user
     * until 0020; the owner controls spend + capability ceiling.
     */
    llmModel: text("llm_model")
      .notNull()
      .default("google/gemini-2.5-flash"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workspaces_slug_idx").on(t.slug),
    index("workspaces_owner_idx").on(t.ownerId),
    uniqueIndex("workspaces_personal_per_owner_uq")
      .on(t.ownerId)
      .where(sql`${t.isPersonal} = true`),
  ],
);

// ─── workspace_members ─────────────────────────────────────────────
//
// Workspace membership controls list access (per the new Inv: list
// visibility = workspace membership ∩ list_members). `role` is the
// app-layer enum WorkspaceRole; no DB CHECK constraint per Phase-1
// convention.
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'owner' | 'admin' | 'editor' | 'viewer' | 'guest'
    role: text("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workspace_members_workspace_user_uq").on(
      t.workspaceId,
      t.userId,
    ),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

// ─── bots ──────────────────────────────────────────────────────────
//
// Phase 4.5 seeds exactly ONE row representing the default platform
// bot (env TELEGRAM_BOT_TOKEN); seeded by workspace-pivot.ts data
// migration with `is_default = true` and `created_by = NULL`. White-
// label bots register in Phase 5 via Workspace-tier admin UI.
//
// Token storage: AES-256-GCM ciphertext (same helper as BYOK keys);
// never logged, never echoed in tool output.
export const bots = pgTable(
  "bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramBotId: bigint("telegram_bot_id", { mode: "number" }).notNull(),
    telegramBotUsername: text("telegram_bot_username").notNull(),
    telegramBotTokenEncrypted: text("telegram_bot_token_encrypted").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("bots_telegram_id_uq").on(t.telegramBotId),
    uniqueIndex("bots_username_uq").on(t.telegramBotUsername),
    uniqueIndex("bots_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`),
  ],
);

// ─── workspace_bots ────────────────────────────────────────────────
//
// Many-to-many junction. Phase 4.5 seeds one row per (workspace,
// default_bot) with is_primary=false. Phase 5 white-label flow ADDS
// a second row with is_primary=true; admin can later revoke the
// default binding explicitly.
export const workspaceBots = pgTable(
  "workspace_bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workspace_bots_pair_uq").on(t.workspaceId, t.botId),
    index("workspace_bots_workspace_idx").on(t.workspaceId),
    index("workspace_bots_bot_idx").on(t.botId),
  ],
);

// ─── workspace_invites ─────────────────────────────────────────────
//
// Phase 5.5: workspace-level invites (mirror of list_invites). Issued
// by `invite_to_workspace` tool / Mini App settings invite form.
// Accept flow lands at `/workspace-invites/[token]`; on accept, a
// `workspace_members` row is inserted. 7-day TTL by default.
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    invitedUsername: text("invited_username").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    // 'admin' | 'editor' | 'viewer' | 'guest' — workspace owner cannot
    // be invited via this flow (transfer-ownership is its own surface).
    role: text("role").notNull().default("editor"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspace_invites_token_idx").on(t.token),
    index("workspace_invites_workspace_idx").on(t.workspaceId),
  ],
);

// ─── bot_users ─────────────────────────────────────────────────────
//
// Records that a user has /start'ed a bot. Required precondition
// for Telegram DM delivery (403 if missing). share_list invite flow
// + Phase 5 reminder dispatch consult this table; absence → fall
// back to default platform bot (every user has /start'ed it).
//
// Composite PK (bot_id, user_id) — no surrogate id.
export const botUsers = pgTable(
  "bot_users",
  {
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.userId] }),
    index("bot_users_user_idx").on(t.userId),
    index("bot_users_bot_idx").on(t.botId),
  ],
);
