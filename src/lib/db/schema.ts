import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
    openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
    llmModel: text("llm_model").notNull().default("anthropic/claude-sonnet-4"),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    activeWorkspaceId: uuid("active_workspace_id").references(
      (): AnyPgColumn => workspaces.id,
    ),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_telegram_username_idx").on(sql`lower(${t.telegramUsername})`),
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
    index("items_status_idx").on(t.listId, t.status),
    index("items_tags_gin").using("gin", t.tags),
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
    tier: text("tier").notNull().default("free"),
    isPersonal: boolean("is_personal").notNull().default(false),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memberLimit: integer("member_limit").notNull(),
    /**
     * Phase 5.5 (G6): Workspace-tier admins can set an org-level
     * OpenRouter key. When a workspace member doesn't have a
     * personal BYOK, the LLM resolution falls back to this key.
     * Encrypted via the same AES-256-GCM helper as user BYOK.
     */
    openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
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

// ─── subscriptions ─────────────────────────────────────────────────
//
// Free workspaces have NO row here — absence-of-row = Free.
// Provider-locked at first paid signup (TR users → Iyzico, others →
// Stripe). Webhook handlers (src/app/api/webhooks/{stripe,iyzico})
// upsert keyed by `(provider, provider_subscription_id)`.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // 'stripe' | 'iyzico' | 'manual'
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    // 'free' | 'team' | 'workspace'
    tier: text("tier").notNull(),
    // 'active' | 'past_due' | 'canceled' | 'trialing'
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_workspace_id_idx").on(t.workspaceId),
    uniqueIndex("subscriptions_provider_sub_idx").on(
      t.provider,
      t.providerSubscriptionId,
    ),
  ],
);

// ─── billing_customers ─────────────────────────────────────────────
//
// One row per (user, provider). Country at first paid signup locks
// the provider — switching providers later requires manual data
// migration. `tax_id` collected at checkout for KDV (TR) or EU VAT.
export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'stripe' | 'iyzico'
    provider: text("provider").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    email: text("email").notNull(),
    // ISO 3166-1 alpha-2 (TR, DE, US, ...)
    country: text("country").notNull(),
    taxId: text("tax_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("billing_customers_user_provider_uq").on(t.userId, t.provider),
    uniqueIndex("billing_customers_provider_customer_uq").on(
      t.provider,
      t.providerCustomerId,
    ),
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
