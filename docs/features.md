# listbull — Feature catalog

> Comprehensive feature list as of 2026-05-08 (post-Phase 12 merge,
> dev branch tip). Anti-list rules in `project-state.md` § "What's
> NOT shipped" still apply. Marked `🆕` if landed in the current
> live-testing session (2026-05-07/08).

## Bot (Telegram)

### Slash commands
- `/start` — onboarding, creates user + Inbox list
- `/lists` — enumerate user's lists with item counts
- `/help` — command reference + tips
- `/share` — share a list with a Telegram username
- `/snapshot` — generate a public snapshot link for a list
- `/reset` — clear bot's conversation memory with the user

### Natural-language tool router (24 tools)
- Item CRUD: create, search, edit, complete/uncomplete, delete, move
  between lists 🆕
- Item discipline: status (Yapılacak / Yapılıyor / Bekliyor /
  Tamamlandı 🆕), priority (Yüksek / Normal / Düşük), free-form tags
  (workspace-wide 20-tag cap)
- List CRUD: create with auto-emoji, rename, archive, restore
- Sharing: invite by Telegram username, role (editor / viewer),
  cancel pending invite, remove member, change member role
- Reminders: schedule absolute (`due_at`) or recurring (RFC 5545
  RRULE 🆕); past times silently dropped with warning; assignee
  receives DM if set, otherwise creator
- Workspaces: create, rename, switch context, list workspaces, invite
  to workspace, remove workspace member
- Settings: locale, timezone, LLM model, notifications, BYOK key
  rotation
- Public snapshots: generate signed read-only URL of a list

### Inbound modes
- Direct chat → LLM router routes to tools above
- Forwarded message extraction: forwarded items auto-create entries
  with explicit list-name resolution
- Inline mode: `@listbull_bot <query>` → in-chat item search results
- Slash command shortcuts (above)

### Outbound (bot → user)
- Reminder DMs at the scheduled time, formatted in user's locale +
  timezone
- Invite DMs (when invitee has started the bot)
- Confirmation messages with the new status-emoji prefix 🆕
  (☐ ▶️ ⏳ ✅ 🗒️) and trailing badges 🆕 (📌 high priority, ⏰
  active reminder)

### Chat hygiene
- 4096-char message cap respected (chunked replies)
- MarkdownV2 escaping for special characters
- Plain-text replies (no markdown decoration that renders as raw
  asterisks)
- Single round-trip per turn; webhook ACKs <60 s

---

## Mini App (Telegram WebApp)

### Routes
- `/lists` — list-of-lists + workspace switcher header
- `/lists/[id]` — items with status badge, priority indicator,
  tag chips, **filter chips with icons** 🆕
- `/lists/[id]/activity` — per-list activity feed
- `/lists/[id]/audit` — owner-only audit + restore (30-day window)
- `/views/today` — workspace-scoped due-today aggregate
- `/workspace/settings` — Plan card, members, custom bot, org-key
- `/workspace/admin` — Workspace-tier admin: usage stats, spend +
  sparkline, member caps, activity timeline, bulk restore
- `/workspace/new` — create workspace
- `/billing/success` — post-checkout landing
- `/invites/[token]` — per-list invite accept (publicly accessible
  per Inv-10 — fix 🆕)
- `/workspace-invites/[token]` — workspace invite accept
- `/settings` — locale, timezone, model, notifications, BYOK key,
  30-day usage badge, workspace cap visibility
- `/snapshot/[token]` — public read-only list view (no auth)

### Item row interactions
- Drag-reorder (long-press handle)
- Swipe-or-tap toggle (mark done)
- Tap text → edit sheet with **status / priority / tags pickers** 🆕
- Edit sheet: text, status, priority, due date, tags 🆕
- Pin glyph 🆕 for high-priority items
- Alarm-clock glyph 🆕 next to active reminders
- Delete via trash icon (soft delete; 30-day restore)

### Filter chip strip (Phase 7)
- Status chips: ▢ Yapılacak | ▶ Yapılıyor | ⌛ Bekliyor | ✓ Tamamlandı
  🆕 (icons added this session)
- Priority chips: ▲▲ Yüksek | = Normal | ▼ Düşük
- Tag chips (workspace vocabulary)
- Multi-select per dimension; "Filtreleri sıfırla" button when active
- Default = hide done items

### Telegram integration
- initData → session via Better Auth Telegram plugin (HMAC-SHA256)
- Telegram theme adapter (light/dark following client)
- MainButton becomes "Save" when edit sheet is dirty
- BackButton routes through Next.js history
- Opens via menu button or `?startapp=...` deeplink

### Workspace admin (Phase 6.5+8+9)
- Member list + role management
- Per-member daily spend caps (Phase 8 `workspace_member_caps`)
- Daily token sparkline (Phase 8)
- Cost projection per workspace (Phase 9)
- Custom workspace-tier bot configuration
- Workspace org-key (operator-side OpenRouter fallback)
- Activity timeline (Phase 9, i18n TR + EN)
- Bulk restore for archived items (Phase 6.5)

---

## Sharing & collaboration

- Per-list invite (token-based, 7-day TTL, 256-bit entropy IS the
  auth surface)
- Invitee receives DM with a `?startapp=invite_<token>` deeplink
  when they've started the bot
- Fallback link returned in the bot's reply when DM is impossible
- Workspace-tier invites (Phase 5.5) for adding members across all
  lists
- Role-based access (owner / editor / viewer)
- Public read-only snapshots via signed URL (Phase 4 D2)

---

## Multi-tenant workspaces

- Default platform bot (`@listbull_bot`) for all users
- Workspace-tier white-label bots (Phase 5) — workspace can register
  its own Telegram bot; reminders + slash commands route through it
- Workspace switching: bot tool + Mini App header dropdown
- Active workspace is per-user state (`users.active_workspace_id`)
- Per-workspace lists, members, items, billing
- Workspace member caps: daily USD-micro spend cap per member 🆕 (in
  the sense of being live-tested this session; shipped earlier)

---

## Billing & licensing (operator-facing)

- Stripe + Iyzico checkout flows
- Subscription state synced via webhook (workspace tier upgrade)
- Self-host license keypair (Ed25519 JWT, Phase 6)
- Operator API for license issuance + revocation
- Public revocation list endpoint (`/api/license-revocations`)
- `licenses` table tracks issuance + revocation
- License email delivery (Resend, Phase 6.5)

---

## Cost & rate limiting

- Per-LLM-call cost tracking in `llm_usage` (Phase 7)
- Cost extracted from token counts × model price (Phase 8)
- Per-workspace + per-user spend visibility
- Per-user hourly message limit (`LISTBULL_PER_USER_HOURLY_MSG_LIMIT`,
  Phase 10)
- Per-workspace member cap enforcement at LLM call time (Phase 8)
- Upstash KV rate limit + idempotency for multi-pod webhook safety
  (Phase 7 P7-D)

---

## i18n + accessibility

- Two locales: TR + EN (no URL prefix; locale data-driven)
- Locale derives from `users.locale` server-side; cookie fallback
- Per-user timezone (TR locale defaults to Europe/Istanbul 🆕,
  others to UTC)
- LLM replies in the user's locale + correct UTC offset
- Mini App labels currently TR-leaning (parity gap tracked in
  backlog)
- aria-labels on radio chip groups + live regions
- Keyboard navigation on filter chips
- Lighthouse a11y target ≥95 (Phase 9 deferred verify on prod)

---

## Privacy & security

- Webhook secret token verification on every Telegram update
- Session cookies httpOnly + Secure + SameSite=Lax
- BYOK API keys AES-256-GCM encrypted at rest (`ENV_KEY`)
- Snapshot URLs HMAC-signed (`SNAPSHOT_SIGNING_KEY`)
- License JWT Ed25519-signed (`LICENSE_PRIVATE_KEY` operator-only)
- Activity log doubles as audit trail with payload-before/after
  JSONB
- 30-day soft-delete window for items + lists with restore endpoint

---

## Operator / infra

- Self-hostable via `docker-compose up -d` from a clean machine
- Multi-bot support: register a workspace's white-label bot via API
- Postgres with hourly backups (per global CLAUDE.md monitoring
  stack)
- Cron container runs `dispatch-reminders.ts` every 60 s (idempotent
  per Inv-11)
- Cleanup cron prunes archived/expired rows (Phase 10)
- Health endpoint `/api/health` exposes db + bot + redis + stripe
  state (auth-exempt for UptimeRobot keyword check)
- Sentry-ready (operator opts in via `NEXT_PUBLIC_SENTRY_DSN`)
- Umami analytics-ready (component pending — see backlog)

---

## In-flight + planned (see `backlog.md`)

- Voice messages (input + opt-in TTS reply) — Phase 13
- Item description / notes — Phase 14a
- Telegram-native attachments (file_id + Mini App previews) —
  Phase 14b
- User-configurable date/time format — Phase 14c
- Decouple deadline from reminder (split `due_at` into
  `deadline_at` + `item_reminders` table) — Phase 14d
- Weekly + calendar deadline views — Phase 15

> "Bot ↔ Mini App parity" rule applies: every feature lands on both
> surfaces or files a tracked follow-up.
