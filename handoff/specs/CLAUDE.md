# listbull

## What it is

listbull is a Telegram-native AI list assistant with persistent shared list memory.
Users chat with the bot in natural language to capture, manage, and share to-dos +
notes; a Telegram Mini App provides visual management. Open source, self-hostable,
BYOK (bring-your-own OpenRouter key).

Primary persona: power Telegram user (Turkish/English, mobile-first) who wants
zero-friction list management plus an AI chat companion in the surface they already
use 50× a day. Secondary: their household members and close collaborators with
shared lists.

## URLs & deployment

- **Prod**: `https://prod.listbull.org`
- **Test/staging**: `https://test.listbull.org`
- **Bot username**: `@listbull_bot` (reserve via BotFather pre-deploy; fallback
  `@listbull_app_bot` if taken)
- **Mini App URL**: `https://prod.listbull.org/app`
- **Bot webhook URL**: `https://prod.listbull.org/api/telegram/webhook` (prod) /
  `https://test.listbull.org/api/telegram/webhook` (test)
- **Status**: DNS pending (post-deploy step)

## Project-specific tech choices

> Only what differs from or extends `~/.claude/CLAUDE.md ## Stack Defaults`.
> See `docs/architecture.md` for full spec.

- **DB tables**: `users`, `lists`, `list_members`, `items`, `messages`,
  `list_invites`, `activity_log` (7 total)
- **Auth**: Telegram-only — Better Auth + custom Telegram initData plugin
  (HMAC-SHA256 verification of Mini App initData query string). No email/password,
  no OAuth.
- **Email**: none in Phase 1. Resend stays in Stack Defaults but unused — all
  notifications go via Telegram DM. Re-enters in Phase 2+ if digest emails added.
- **AI/LLM**: OpenRouter (BYOK per user). Default model `anthropic/claude-sonnet-4`,
  per-user override via Mini App settings. Anthropic SDK pointed at OpenRouter
  base URL. ~9 tools defined for LLM tool calling: `create_item`, `search_items`,
  `update_item`, `complete_item`, `delete_item`, `list_lists`, `share_list`,
  `schedule_reminder`, `assign_item`.
- **i18n**: TR + EN at launch via `next-intl`. **No path prefix** — locale is
  `users.locale`-driven, server-side per-request. URL stays clean.
- **3rd-party additions**:
  - `grammY` — Telegram bot framework (Node.js, modern, full TS types)
  - `@telegram-apps/sdk-react` — official Mini App SDK (theme, initData, MainButton, BackButton)
  - `next-intl` — i18n
  - `@anthropic-ai/sdk` — LLM client (with OpenRouter `baseURL` swap)
  - `@dnd-kit/core` — drag-reorder in Mini App
  - Dokploy cron container — once/minute reminder dispatcher

## Features (with acceptance criteria)

### Conversational capture
- Description: plain-text message → LLM detects intent → item created in correct list (default Inbox)
- Acceptance:
  - [ ] Send "süt al" → item created in Inbox
  - [ ] Send "okuma listesine Sapiens ekle" → item in Okuma list (auto-resolved)
  - [ ] Bot replies <8s including LLM round-trip
  - [ ] activity_log row written for every create

### Conversational search/recall
- Description: natural-language query → LLM `search_items` tool → natural reply
- Acceptance:
  - [ ] "Okuma listemde ne var?" returns natural language summary
  - [ ] "Sapiens'i ekledim mi?" returns yes/no with context
  - [ ] LLM can cross-reference multiple lists if needed

### Conversational manage
- Description: edit, complete, delete, schedule via natural language
- Acceptance:
  - [ ] "süt'ü işaretle" → completes item
  - [ ] "Sapiens'i sil" → deletes item (with activity_log entry for restore)
  - [ ] "yarın saat 18'de spor yapmamı hatırlat" → creates item with `due_at`

### General Q&A
- Description: list-unrelated questions → standard LLM response, no tool calls
- Acceptance:
  - [ ] "Türkiye'nin başkenti?" → bot replies normally without modifying state
  - [ ] System prompt explicitly allows non-tool responses

### Multi-turn dialogue
- Description: bot maintains conversation context within a session
- Acceptance:
  - [ ] "yarın için alışveriş listesi hazırla" → bot asks "hangi öğeler"
  - [ ] User fills items one-by-one or in bulk → bot creates list + items
  - [ ] Last 30 messages kept in LLM context

### Slash commands (deterministic)
- Description: deterministic ops bypass LLM
- Acceptance:
  - [ ] `/start` creates user + Inbox; sends welcome
  - [ ] `/help` lists capabilities + slash commands
  - [ ] `/lists` returns list of lists with deeplinks to Mini App
  - [ ] `/share` opens share flow for current/specified list
  - [ ] `/reset` clears conversation history with confirm
  - [ ] All return <100ms (no LLM in path)

### Scheduled reminders
- Description: items with `due_at` trigger DM reminder at scheduled time
- Acceptance:
  - [ ] Cron job runs every 60s, queries due items
  - [ ] DM arrives within 1 min of `due_at`
  - [ ] `reminder_sent` flag prevents double-fire

### Mini App list & item management
- Description: visual UI for list/item CRUD + drag-reorder
- Acceptance:
  - [ ] Open Mini App → see all my lists
  - [ ] Tap list → see items with circular checkbox + edit + delete
  - [ ] Toggle item → optimistic UI, DB reflects in <1s
  - [ ] Drag-reorder via long-press
  - [ ] Mobile + desktop responsive
  - [ ] Theme matches Telegram dark/light setting

### Per-list sharing
- Description: invite individual users to specific lists by Telegram username
- Acceptance:
  - [ ] Owner enters @username → invite token created → DM sent to invitee
  - [ ] Invitee taps deeplink → Mini App accept screen → joins list as editor
  - [ ] Both can create/edit items; activity log shows both actors
  - [ ] Owner can revoke editor; non-owners cannot revoke

### Mini App settings
- Description: per-user preferences (BYOK, model, locale, timezone, notifications)
- Acceptance:
  - [ ] BYOK key field is masked (last 4 chars visible after save)
  - [ ] Key encrypted at rest with AES-256-GCM via `ENV_KEY`
  - [ ] Model selector picks from preset list, persists in `users.llm_model`
  - [ ] Timezone uses IANA names; honors `Intl.DateTimeFormat`
  - [ ] Locale switch (TR/EN) reloads UI
  - [ ] Save via Telegram MainButton when dirty

### Telegram initData auth
- Description: Mini App auth via Telegram-signed initData
- Acceptance:
  - [ ] HMAC-SHA256 verified against bot token
  - [ ] Expired (>24h) initData rejected
  - [ ] Better Auth session cookie issued; subsequent fetches authenticated

### Conversation history persistence
- Description: chat history per `(user_id, chat_id)` for LLM context
- Acceptance:
  - [ ] Every user/assistant/tool message persisted to `messages` table
  - [ ] Last 30 messages OR ~6k tokens loaded into LLM context (whichever first)
  - [ ] `/reset` clears history for current chat

### Real-time-ish sync (5s polling)
- Description: shared list updates propagate within 5s without push
- Acceptance:
  - [ ] TanStack Query `refetchInterval: 5000` on shared list views
  - [ ] Pause when tab hidden (visibility API)
  - [ ] Phase 1 = polling only; websockets deferred to Phase 2+

### A3: Forwarded message → action items
- Description: forwarding a message to bot extracts action items
- Acceptance:
  - [ ] Webhook detects `forward_origin` field
  - [ ] LLM extracts items from forwarded text
  - [ ] Items added to user's chosen/inferred list

### B1: Activity feed per shared list
- Description: feed view shows mutations on shared lists
- Acceptance:
  - [ ] Mini App route `(app)/lists/[id]/activity` shows last 50 events
  - [ ] Grouped by day with sticky labels
  - [ ] Each row: actor avatar, relative timestamp, localized sentence

### B2: @mention assignment
- Description: assign items to list members via @mention
- Acceptance:
  - [ ] "@ali süt'ü sen al" → LLM resolves "ali" → `assignee_id` set
  - [ ] Mini App shows assignee avatar badge on item
  - [ ] Reminder DMs go to the assignee, not just creator

### C1: Docker Compose deploy
- Description: clean-machine self-host via Docker Compose
- Acceptance:
  - [ ] `docker-compose up` brings up Postgres + Next.js + cron
  - [ ] Only `.env` configuration required from operator
  - [ ] First-run wizard guides through bot setup if not configured

### C2: .env.example + first-run setup wizard
- Description: documented env + onboarding for self-hosters
- Acceptance:
  - [ ] Every env var documented in `.env.example`
  - [ ] First Mini App load detects missing config → setup wizard
  - [ ] Wizard validates BotFather token, webhook URL, DB connection

### C3: E2E test suite
- Description: Playwright test coverage of critical flows
- Acceptance:
  - [ ] Auth flow (Mini App initData verify)
  - [ ] Bot intent → item creation
  - [ ] Share flow (cross-account)
  - [ ] Restore flow
  - [ ] Runs on every PR via GitHub Actions

### D1: Bot inline mode
- Description: `@listbull_bot <query>` in any chat → suggestions inline
- Acceptance:
  - [ ] BotFather inline mode enabled
  - [ ] Inline query returns up to 10 most-recent items across user's lists
  - [ ] Tap result → action (TBD: open Mini App vs add to list — Phase 4 decision)

### D2: Shareable list snapshot
- Description: forwardable Telegram message with current list state + deeplink
- Acceptance:
  - [ ] User triggers via `/share` or Mini App share sheet
  - [ ] Bot sends message containing list contents + deeplink
  - [ ] Deeplink resolves to public read-only snapshot page (`(marketing)/snapshot/[id]`)

### D3: Schedule-a-message pickup
- Description: native Telegram scheduled-message support
- Acceptance:
  - [ ] User schedules native Telegram message to bot at future time
  - [ ] Bot processes at scheduled time as if just sent
  - [ ] No special handling needed — webhook is time-agnostic; document pattern in README

### E1: i18n TR/EN at launch
- Description: bot + Mini App support TR and EN
- Acceptance:
  - [ ] `messages/{tr,en}.json` complete
  - [ ] Mini App locale switch in settings
  - [ ] Bot replies in user's preferred language
  - [ ] Initial locale set from Telegram `language_code`

### E2: Mini App accessibility
- Description: WCAG AA + Lighthouse a11y ≥95
- Acceptance:
  - [ ] Lighthouse a11y on `/app/lists` ≥95
  - [ ] Full keyboard navigation (Tab order, Enter activate, Space drag)
  - [ ] ARIA labels on all custom controls
  - [ ] `prefers-reduced-motion` respected

### E3: Bot multilingual response
- Description: LLM auto-detects user message language → responds in same language
- Acceptance:
  - [ ] System prompt instructs locale-following
  - [ ] Mixed-language input → dominant language detected
  - [ ] User's `users.locale` is fallback when ambiguous

### F1: Full data export
- Description: user can download all their data
- Acceptance:
  - [ ] Settings → "Download my data" → JSON dump
  - [ ] Includes: own items, lists, activity, messages
  - [ ] Excludes: other users' data, encrypted API key
  - [ ] 24h signed URL via Hetzner Object Storage

### F2: Audit log + restore
- Description: shared list owner can view full mutation log + restore deleted items
- Acceptance:
  - [ ] Owner-only route `(app)/lists/[id]/audit`
  - [ ] Filter chips: All / Deletions / Edits / Permissions
  - [ ] Restore button on deletions ≤30 days old
  - [ ] Restore reconstructs item from `payload_before` in transaction

## Design system

> Full spec: `docs/design.md`

- **Schema**: Minimal Clean with Telegram-native theme adaptation
- **Adjective stack**: functional, calm, fast, native, trustworthy
- **Colors**: brand teal `#00D9C0` accent across both modes; light bg `#FFFFFF`/fg `#000000`/card `#F4F4F5`; dark bg `#17212B`/fg `#F5F5F5`/card `#232E3C`. Mini App reads Telegram `themeParams` at runtime — palette adapts; brand teal stays constant.
- **Typography**: Inter (400/500/600/700) — single font family, no display font
- **Density**: balanced (56px mobile / 48px desktop item rows)
- **Dark mode**: required (auto-respects Telegram theme; no manual toggle inside Mini App). Marketing landing is light-only.
- **Anti-list**: glassmorphism, gradient text/backgrounds, stock teamwork illustrations, neon glows, emoji-as-decoration, AI-themed cosmic imagery, decorative line illustrations, skeumorphic shadows.

---

## Engineering conventions

> The sections below come from vibe-engineer (Phase 3c). They live HERE in CLAUDE.md
> (not in a separate docs file) because Claude Code needs them on every session.

### Folder structure

```
listbull/
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/                       # public landing page (light-only)
│  │  │  ├─ page.tsx                        # landing
│  │  │  ├─ snapshot/[id]/page.tsx          # D2 read-only snapshot
│  │  │  ├─ opengraph-image.tsx             # OG image (next/og)
│  │  │  └─ layout.tsx
│  │  ├─ (app)/                             # Mini App (Telegram theme)
│  │  │  ├─ layout.tsx                      # mounts theme adapter, MainButton, BackButton
│  │  │  ├─ lists/
│  │  │  │  ├─ page.tsx                     # list of lists
│  │  │  │  └─ [id]/
│  │  │  │     ├─ page.tsx                  # items in list
│  │  │  │     ├─ activity/page.tsx         # B1 activity feed
│  │  │  │     └─ audit/page.tsx            # F2 audit (owner-only)
│  │  │  ├─ invites/[token]/page.tsx        # invite-accept screen
│  │  │  ├─ settings/page.tsx               # BYOK + prefs
│  │  │  └─ setup/page.tsx                  # C2 first-run wizard
│  │  ├─ api/
│  │  │  ├─ telegram/webhook/route.ts       # bot webhook
│  │  │  ├─ auth/telegram/route.ts          # initData verify → session
│  │  │  ├─ lists/                          # list CRUD
│  │  │  ├─ items/                          # item CRUD
│  │  │  ├─ invites/                        # invite accept + cancel
│  │  │  ├─ settings/                       # GET/PATCH + export
│  │  │  └─ health/route.ts                 # uptime endpoint
│  │  └─ layout.tsx
│  ├─ components/
│  │  ├─ ui/                                # shadcn primitives (regenerable)
│  │  ├─ telegram/                          # theme-provider, MainButton, BackButton wrappers
│  │  ├─ lists/                             # item-row, item-list, share-sheet, list-header, add-item-composer
│  │  ├─ activity/                          # activity-row, activity-list, activity-sentence, item-pill
│  │  ├─ audit/                             # audit-row, audit-list, filter-chips, restore-button
│  │  ├─ marketing/                         # hero, features-grid, footer, phone-mock
│  │  ├─ settings/                          # api-key-field, model-selector, timezone-picker
│  │  └─ shared/                            # empty-state, checkbox-circle
│  ├─ lib/
│  │  ├─ ai/                                # AI-agent owned
│  │  │  ├─ tools.ts                        # tool schemas (zod)
│  │  │  ├─ prompts/system.v1.ts            # system prompt (versioned)
│  │  │  ├─ conversation.ts                 # context window slicing
│  │  │  ├─ respond.ts                      # main LLM orchestration
│  │  │  └─ types.ts
│  │  ├─ auth/
│  │  │  └─ telegram-plugin.ts              # initData HMAC + Better Auth plugin
│  │  ├─ cron/
│  │  │  └─ dispatch-reminders.ts           # cron entry — runs every 60s
│  │  ├─ db/
│  │  │  ├─ client.ts                       # Drizzle client
│  │  │  ├─ schema.ts                       # all 7 tables
│  │  │  └─ queries/                        # query helpers (lists, items, messages, etc.)
│  │  ├─ server/                            # Backend-agent server-only logic
│  │  │  ├─ bot/
│  │  │  │  ├─ handle-message.ts            # LLM router for bot messages
│  │  │  │  ├─ handlers/inline-query.ts     # D1 inline mode
│  │  │  │  ├─ commands/                    # /start, /help, /lists, /share, /reset
│  │  │  │  └─ snapshot.ts                  # D2 snapshot generator
│  │  │  ├─ tools/                          # 9 tool executors (one file each)
│  │  │  ├─ lists/                          # invite, accept-invite, members
│  │  │  ├─ export.ts                       # F1
│  │  │  ├─ restore.ts                      # F2
│  │  │  └─ encryption.ts                   # AES-256-GCM helpers for BYOK key
│  │  ├─ telegram/                          # client-side WebApp SDK adapters
│  │  │  └─ theme-adapter.ts
│  │  ├─ types/                             # Architect-owned (frozen after Phase 1)
│  │  │  └─ index.ts
│  │  ├─ validators/                        # zod schemas (Backend-owned)
│  │  │  ├─ items.ts
│  │  │  ├─ lists.ts
│  │  │  └─ settings.ts
│  │  ├─ env.ts                             # type-safe env (zod-validated)
│  │  └─ utils.ts
│  ├─ hooks/                                # use-list-items, use-telegram-theme, etc.
│  ├─ i18n/                                 # next-intl config
│  └─ middleware.ts                         # auth gate for (app) routes
├─ messages/                                # next-intl translation files
│  ├─ tr.json
│  └─ en.json
├─ drizzle/                                 # generated migrations (checked in)
├─ tests/                                   # Phase 4 — Vitest + Playwright
├─ scripts/                                 # one-off ops
├─ public/
├─ .env.example
├─ docker-compose.yml                       # Phase 4
├─ Dockerfile
├─ Dockerfile.cron
└─ README.md
```

**Notes:**
- Two route groups: `(marketing)` (light-only, no theme adapter) and `(app)` (Telegram theme).
- `src/lib/server/**` is Backend-agent territory — frontend never imports from here.
- `src/lib/ai/**` is AI-agent territory — Backend imports from here, defines executors in `src/lib/server/tools/`.
- Migrations folder checked in; never edit manually — always via `drizzle-kit generate`.
- No barrel files (`index.ts` re-exports) except `src/lib/types/index.ts` (Architect's curated public surface).

### Naming conventions

Defaults — no overrides for this project:
- Files: `kebab-case.ts` / `kebab-case.tsx`
- React components: `PascalCase` exported as default
- Hooks: `use-X.ts`, `useX` named export
- DB tables: `snake_case` plural
- ORM table objects (Drizzle): `camelCase` matching var name
- Env vars: `UPPER_SNAKE_CASE`, `NEXT_PUBLIC_` prefix only when client-exposed

### Component organization

- shadcn primitives live in `src/components/ui/` (regenerable; rarely touched)
- Feature components in `src/components/<feature>/` (e.g. `src/components/lists/item-row.tsx`)
- Telegram-specific wrappers in `src/components/telegram/`
- Page-only components colocate in route folder (`src/app/(app)/lists/[id]/_components/`) — rare; prefer feature folder
- No barrel files

### API patterns

- **Mutations**: route handlers (`/api/.../route.ts`), not server actions. Reason: Mini App + bot share API surface; bot's webhook handler also calls them internally via the same handler functions.
- **Webhooks**: `/api/telegram/webhook/route.ts` is `force-dynamic`, parses raw body, verifies `X-Telegram-Bot-Api-Secret-Token` header.
- **Public API**: none in Phase 1. Phase 5+ may add `/api/v1/...` for external integrations.
- **Auth check pattern**: `middleware.ts` gates all `/app/*` routes (verify Better Auth session); API routes check session per-route via Better Auth's `auth()` helper.
- **Error envelope**: `{ ok: true, data }` / `{ ok: false, error: { code, message } }` — consistent across all handlers.

### State management

- **Server state**: TanStack Query for client-side fetching not covered by RSC. Use `refetchInterval: 5000` on shared list views; pause on hidden tab.
- **Form state**: react-hook-form + zod (schemas in `src/lib/validators/`)
- **Global UI**: Context for Telegram WebApp instance; no Zustand needed (Phase 1 has minimal cross-screen state)
- **URL state**: `nuqs` for filter chips on activity/audit views; not needed elsewhere in Phase 1

### Error / loading / empty states

- **Loading**: Skeleton primitive matching layout (never spinners except button-internal). 6 skeleton rows for list views.
- **Empty**: shared `<EmptyState />` component (icon + title + 1-line description + CTA)
- **Error**: error boundary per route segment + capture in **Sentry** + retry button. User-facing copy: "Bir şeyler ters gitti. Tekrar dene." (TR) / "Something went wrong. Try again." (EN)
- **Not-found**: custom `not-found.tsx` for `(app)/lists/[id]` (covers deleted/no-access lists)
- **Optimistic UI**: required for item-toggle, item-delete, item-reorder, item-edit, settings-save (use `useOptimistic` or TanStack mutate)

### Form patterns

- react-hook-form + zod (single source of truth per form)
- Schemas in `src/lib/validators/` — same schema validates client + server
- Submit button shows loading via `isSubmitting`
- Inline field errors + top-level toast for submission failures
- Telegram MainButton replaces in-page submit on Mini App edit screens (settings, item-edit sheet, share-sheet)

### Testing strategy

> Calibrated to Stack Defaults' Verification gates: **pragmatic** (Phases 1, 2, 3, 5);
> **strict** (Phase 4 — OSS-quality phase).

- **Unit (Vitest)**: critical `src/lib/**` modules
  - `src/lib/ai/conversation.ts` — slicing rules
  - `src/lib/server/encryption.ts` — AES-256-GCM round-trip
  - `src/lib/auth/telegram-plugin.ts` — HMAC verify (positive + negative cases)
  - `src/lib/server/tools/*.ts` — at least 1 test per executor (Phase 4)
- **Component**: skipped in Phase 1-3; consider Storybook for `<ItemRow />` and `<ShareSheet />` in Phase 4 if user demand
- **E2E (Playwright)**: Phase 4 only
  - Mini App auth flow (initData → session)
  - Bot intent → item (mock webhook payload)
  - Share flow (cross-account)
  - F2 restore flow
  - Settings save (BYOK round-trip without exposing plaintext)

### Verification gate — per-phase commit checklist

> Style: **pragmatic** (Phases 1, 2, 3, 5) / **strict** (Phase 4)

**Pragmatic (Phases 1, 2, 3, 5)**:
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] Smoke test the new feature end-to-end (bot path + Mini App path)
- [ ] Then commit + push to `dev` branch (auto-deploys to test)

**Strict (Phase 4)**:
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test` (Vitest) clean
- [ ] `npm run e2e` (Playwright) clean
- [ ] Lighthouse a11y on Mini App `/app/lists` ≥95
- [ ] `docker-compose up` on a fresh node (no .env, follow README) → both bot and Mini App functional
- [ ] README "Quickstart" produces working install in <15 min
- [ ] Then commit + push to `main`

### Pre-commit additions (project-specific)

- gitleaks (Stack Defaults' secret scanning) — already wired
- `lint-staged`: tsc on changed `.ts`/`.tsx` files (recommended for flagship project)
- No commitlint — Stack Defaults' commit convention is informal

---

## Project-specific gotchas

- **Bot username squatting.** Check `https://t.me/listbull_bot` and BotFather `/mybots` before deploy. If `@listbull_bot` is taken, fall back to `@listbull_app_bot` and update README + Mini App config + marketing landing CTA.
- **Webhook secret rotation.** Telegram lets you set a `secret_token` on `setWebhook`. Verify the `X-Telegram-Bot-Api-Secret-Token` header on every request; rotate on prod via env redeploy. Failing to verify = open webhook = anyone can spoof updates.
- **initData expires in 24h.** Telegram convention. Re-issue session cookie when initData is fresh; fall back to existing session when older.
- **Telegram message length cap = 4096 chars.** LLM replies occasionally exceed; chunk on word boundaries before sending.
- **MarkdownV2 escaping.** Telegram requires escaping `_*[]()~\`>#+-=|{}.!`. Use grammY's `formatter` helper, never raw concat.
- **Cron timezone.** Dokploy cron container runs UTC. Reminder due-time comparisons must be UTC-consistent; user's local time is presentation-only.
- **Webhook handler must respond 200 within 60s.** Pattern: ack 200 immediately, do LLM work in background, then call `sendMessage`. Telegram retries with exponential backoff on 5xx.
- **BYOK key encryption.** AES-256-GCM via env `ENV_KEY`. If `ENV_KEY` is rotated, all stored keys are unreadable — document rotation procedure (re-prompt users to re-enter).
- **Self-host operators are data controllers.** README needs a "Data flows" section: where Postgres lives, retention policy (forever unless user exports + deletes), GDPR-relevant notes for EU operators.
- **Tool execution is transactional.** Every LLM tool call wraps in a single Drizzle transaction: insert/update entity + insert activity_log row. Half-applied state breaks the audit log.
- **No localStorage / DeviceStorage for state.** Frontend renders, backend owns. Multi-device sync would break otherwise.

## Work plan & agents

> Phase summary here; full spec: `docs/architecture.md` (Phasing); **executable agent
> plan: `docs/agents.md`**.

- **Execution mode**: Hybrid — Phase 1 single-session, Phases 2-5 multi-agent
- **Phases**:
  - **Phase 1 — Foundation**: scaffold, 7-table schema, initData auth, read-only Mini App, basic slash commands. Verification: pragmatic.
  - **Phase 2 — Core conversational + manage**: 6 LLM tools (CRUD + list_lists), Mini App mutations + drag, conversation history, BYOK settings. Verification: pragmatic.
  - **Phase 3 — Sharing + reminders + assignments**: 3 more tools (`share_list`, `schedule_reminder`, `assign_item`), invite token flow, cron job, B1+B2 enhancements. Verification: pragmatic.
  - **Phase 4 — Polish + open-source quality**: all remaining enhancements (A3, C1-C3, D1-D3, E1-E3, F1-F2), Docker Compose, README, LICENSE, CONTRIBUTING, E2E suite, Lighthouse a11y. Verification: **strict**.
  - **Phase 5 — Launch prep**: production DNS cutover, BotFather setup, repo public, demo. Verification: pragmatic.

- **Agent roster** (full scope + contracts in `docs/agents.md`):
  - **Architect-agent** — folder structure validation, schema review, type freezing in `src/lib/types/`, Claude Design bundle token validation
  - **Backend-agent** — bot webhook, slash commands, LLM tool implementations, Drizzle queries/migrations, cron, activity_log writes
  - **Frontend-agent** — Mini App routes, components, optimistic UI, theme adapter, accessibility, marketing landing
  - **AI-agent** — system prompt, tool schemas (zod), conversation slicing, multi-turn flow, prompt versioning
  - **Reviewer-agent** — per-phase lint/tsc runs, security pass, OSS-quality pass (Phase 4: README, LICENSE, .env.example, Docker validation, Lighthouse, E2E)

> **For Claude Code orchestrator session**: read `docs/agents.md` first. It contains
> per-agent scope, inter-agent contracts, per-feature assignments, and ready-to-paste
> Task tool invocation snippets for each phase.

## Commands

- `npm run dev` — local dev (Next.js + Drizzle + bot in webhook mode pointed at ngrok or test.listbull.org)
- `npm run build` — production build
- `npm run lint` / `npx tsc --noEmit` — checks
- `npm run test` — Vitest (Phase 4+)
- `npm run e2e` — Playwright (Phase 4+)
- `npm run db:generate` — `drizzle-kit generate` (after schema change)
- `npm run db:migrate` — apply migrations to current `DATABASE_URL`
- `npm run db:studio` — Drizzle Studio for DB inspection
- `npm run cron` — manual cron run (for local testing)

## Reference

- `docs/research.md` — competitors (listOK, ToBeDo, Taskobot), market gap, patterns, pain points, sources
- `docs/architecture.md` — domain instance, full DB schema, auth, AI/LLM spec, integrations, performance, monitoring, gotchas, work plan
- `docs/design.md` — design system spec (schema, palette, typography, components, motion, accessibility, anti-list)
- **`docs/agents.md` — executable agent plan (THE handoff document for Claude Code)**
- **`docs/design-prompts.md` — executable Claude Design prompts (THE handoff document for claude.ai/design)**
- `~/.claude/CLAUDE.md` — global Stack Defaults

## Open questions / TODOs

- **Bot username availability.** Check `@listbull_bot` BEFORE Phase 1 starts; if taken, fall back to `@listbull_app_bot`. Update README, Mini App config, marketing landing accordingly.
- **Cron heartbeat target.** Architecture proposes Better Stack heartbeat URL (env-configurable). Phase 3 implementation: opt-in only? Default-on with public endpoint that does nothing? Decide during Phase 3 architect pass.
- **Inline mode result-list cap (D1).** 10 most-recent items vs LLM-ranked? Decide during Phase 4 architect pass.
- **Snapshot expiry (D2).** Default 30-day expiry; user-configurable column added in Phase 4 if user demand surfaces during Phase 4 review.
- **Demo GIF format.** GIF (universal) vs MP4 (smaller, smoother). Decide during Phase 4 design-prompt iteration on Prompt 7.
- **Per-user OpenRouter key validation timing.** Phase 1 = lazy (validate on first LLM call). If users complain "didn't realize key was wrong until I asked", switch to eager validation in Phase 4.
- **Mini App full-screen mode.** Telegram supports `requestFullscreen()`; Phase 1 doesn't enable. Revisit per-user setting in Phase 2 if mobile UX needs it.
- **Webhook vs long-polling for self-host.** Phase 1 = webhook only (requires public HTTPS). Long-polling toggle deferred unless self-host operators behind NAT request it.
