# Phase 1 Review — Foundation

> Generated 2026-05-01 by orchestrator session (single-session per `handoff/specs/agents.md`).
> Verification gate: **pragmatic**.

## Status: PASS (lint + tsc + build clean) · live smoke deferred (no bot token / DB yet)

---

## What shipped

### Stack
- Next.js 16.2.4 (App Router, Turbopack), React 19, TypeScript strict + `noUncheckedIndexedAccess`
- Tailwind v4 (CSS-first config) with token bridge from `handoff/tokens/tokens.css` → `--lb-*` CSS vars + `@theme inline` for utility classes
- Drizzle 0.45 + `postgres` driver, `casing: "snake_case"`
- Better Auth 1.6 installed (full plugin wiring deferred to Phase 2 — Phase 1 ships a minimal HMAC-signed session cookie)
- grammY 1.42 for bot
- `@telegram-apps/sdk-react` 3.3 installed (theme adapter is bare-bones DOM API — full SDK use lands in Phase 2)
- next-intl 4.11 installed (Phase 2 will wire messages files)

### Database
- `src/lib/db/schema.ts`: all 7 tables defined per `handoff/specs/architecture.md`
  - `users` (telegram_id unique, lowered username index, llm_model/locale/tz/encrypted BYOK key)
  - `lists` (partial unique on `(owner_id) where is_inbox = true`)
  - `list_members` (composite unique on `(list_id, user_id)`, role text)
  - `items` (composite list-render index, partial cron-pickup index, assignee index)
  - `messages` (chat-recent index)
  - `list_invites` (token unique)
  - `activity_log` (list-recent + entity-recent indexes; dual-purpose feed/audit)
- Initial migration: `drizzle/0000_initial.sql` (checked in)
- `src/lib/types/index.ts`: types derived via `$inferSelect` / `$inferInsert`. Frozen — Architect-agent owns from here.
- `src/lib/db/queries/`: read-only helpers for Phase 1 (`users.ts`: get + upsert; `lists.ts`: ensureInbox, listListsForUser, getList, listItemsInList, userCanReadList)

### Auth
- `src/lib/auth/telegram-plugin.ts`: pure HMAC-SHA256 verifier per the Telegram Mini App spec. Constant-time hash compare. 24h `auth_date` expiry. JSON-parses `user` field defensively.
- `src/lib/auth/session.ts`: HMAC-signed cookie session (httpOnly, lax, 30d TTL). Edge-safe constants moved to `src/lib/auth/cookie.ts` so the proxy module doesn't pull `node:crypto`.
- `POST /api/auth/telegram`: validates initData → upserts user → ensures Inbox → sets cookie.
- `src/proxy.ts` (Next 16 proxy, formerly middleware): redirects unauthenticated users on `/lists/*`, `/settings/*`, `/invites/*` to `/`.

### Bot (slash commands only — no LLM yet)
- `POST /api/telegram/webhook`: verifies `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`, parses Update, dispatches via grammY, always returns 200 (errors logged not thrown — Telegram retry storms avoided).
- `/start`: upserts user, ensures Inbox, replies localized welcome (TR/EN auto-pick from Telegram language_code).
- `/help`: localized command help.
- `/lists`: deeplink-ed list of user's lists with emoji prefix, MarkdownV2-escaped.
- Inline TR/EN dictionary in `src/lib/server/bot/i18n.ts` (next-intl wiring is Phase 2/4).

### Mini App (read-only)
- `(app)/layout.tsx`: loads Telegram WebApp SDK via `<Script strategy="beforeInteractive">`, mounts `TelegramThemeProvider`. Marked `noindex`.
- `(app)/app/page.tsx`: client-side boot — reads `Telegram.WebApp.initData`, posts to `/api/auth/telegram`, redirects to `/lists`. Handles "no Telegram" + "auth failed" branches.
- `(app)/lists/page.tsx`: server component, lists user's lists (Inbox first), empty state with /start hint.
- `(app)/lists/[id]/page.tsx`: server component, items in list, custom 22×22 circular checkbox per design spec, strikethrough + opacity for completed, empty state.
- `GET /api/lists` and `GET /api/lists/[id]/items`: session-gated read endpoints.

### Marketing landing
- `(marketing)/page.tsx`: minimal hero stub (wordmark, tagline, "Open in Telegram" CTA, GitHub footer link). Light-only via route-group layout.

### Health / monitoring
- `GET /api/health`: SELECT 1 ping, returns `{status, db, ts}`. Auth-exempt. Matches UptimeRobot keyword check shape from global CLAUDE.md.

### Design tokens
- `handoff/tokens/tokens.css` content inlined into `src/app/globals.css` (one canonical copy).
- Tailwind v4 `@theme inline` exposes `--lb-*` to utility classes (`bg-bg`, `text-fg`, etc.).
- `prefers-reduced-motion` honored globally.

### Telegram theme adapter
- `src/lib/telegram/theme-adapter.ts`: maps `Telegram.WebApp.themeParams` → `--lb-*` CSS vars, listens to `themeChanged` event, brand `--lb-accent` stays constant.
- `link_color` deliberately ignored — accent is the immovable signal color per design spec.

### Project hygiene
- `prompts/` removed (handoff/specs/ canonical).
- Root `CLAUDE.md` rewritten — concise, project-specific only, references global CLAUDE.md for stack defaults (no duplication).
- `.env.example` rewritten: Postgres + Better Auth + Telegram + BYOK + optional analytics/Sentry/heartbeat (no Supabase).
- `README.md` updated: domain `listbull.org`, real scripts, current stack.

---

## Verification gate

| Check | Status |
|-------|--------|
| `npm run lint` | ✅ clean (eslint flat config, eslint-config-next/{core-web-vitals,typescript}) |
| `npx tsc --noEmit` | ✅ clean (strict + noUncheckedIndexedAccess) |
| `SKIP_ENV_VALIDATION=1 npm run build` | ✅ clean (Turbopack, 4 static + 6 dynamic routes + Proxy) |
| `npm run dev` boots clean | ⏳ not run live (no DATABASE_URL); expected to start since build works |
| `drizzle-kit migrate` against fresh DB | ⏳ deferred (no DB credentials yet) |
| `/start` smoke test on test bot | ⏳ deferred (no bot token yet) |
| Mini App opens, Inbox visible | ⏳ deferred (chained on above) |

**Live smoke tests deferred** by user direction — bot token, DB, OpenRouter key not provisioned yet. Will run in the Phase 2 onset window.

---

## Known gaps / Phase-2 onset checklist

These are NOT Phase 1 scope per `handoff/specs/agents.md` but are logged here to avoid surprises when Phase 2 starts.

1. **Better Auth full plugin wiring.** Phase 1 ships a hand-rolled HMAC cookie. Phase 2 should mount the Telegram initData plugin into Better Auth proper so the auth schema (sessions, accounts) is generated.
2. **next-intl wiring.** Mini App still uses raw inline strings; Phase 4 enhancement E1 brings `messages/{tr,en}.json` + `next-intl` server config. Bot side already has its own dictionary.
3. **Lazy env validation pattern.** Currently `src/lib/env.ts` uses a Proxy that lazy-validates on first access, with a build-phase fallback that returns placeholders. Works for build, but Phase 4 should add a `validate-env.ts` script run in CI to assert the schema before deploy.
4. **shadcn primitives not generated.** `src/components/ui/` is empty. Phase 2 will run `shadcn add button input sheet alert-dialog switch skeleton sonner` and use those instead of inline-styled elements.
5. **Bot username availability.** `@listbull_bot` not reserved on BotFather yet. Confirm before Phase 5 launch; fall back to `@listbull_app_bot` if taken (env var `TELEGRAM_BOT_USERNAME` already supports either).
6. **Sentry not wired.** Phase 4 OSS-quality pass adds `instrumentation-client.ts` + Dockerfile build args per global CLAUDE.md "Sentry / Next 16 Turbopack" gotcha.
7. **Umami tracking not wired.** Phase 4 — run `~/scripts/wire-umami.sh listbull` after first prod deploy.

---

## Files shipped this phase

```
src/
├─ app/
│  ├─ (app)/
│  │  ├─ app/page.tsx            ← client boot (initData → cookie → /lists)
│  │  ├─ layout.tsx              ← Telegram theme adapter mount
│  │  ├─ lists/[id]/page.tsx     ← items in list, read-only
│  │  └─ lists/page.tsx          ← list of lists
│  ├─ (marketing)/
│  │  ├─ layout.tsx              ← force light theme
│  │  └─ page.tsx                ← hero stub
│  ├─ api/
│  │  ├─ auth/telegram/route.ts  ← initData verify → session
│  │  ├─ health/route.ts
│  │  ├─ lists/[id]/items/route.ts
│  │  ├─ lists/route.ts
│  │  └─ telegram/webhook/route.ts
│  ├─ globals.css
│  └─ layout.tsx
├─ components/
│  ├─ lists/item-row.tsx
│  ├─ lists/list-row.tsx
│  ├─ shared/empty-state.tsx
│  └─ telegram/theme-provider.tsx
├─ lib/
│  ├─ auth/{cookie.ts, session.ts, telegram-plugin.ts}
│  ├─ db/{client.ts, schema.ts, queries/{lists.ts, users.ts}}
│  ├─ env.ts
│  ├─ server/auth/require-user.ts
│  ├─ server/bot/{escape-markdown.ts, i18n.ts, index.ts, commands/{help.ts, lists.ts, start.ts}}
│  ├─ telegram/{theme-adapter.ts, webapp-types.ts}
│  ├─ types/index.ts
│  └─ utils.ts
└─ proxy.ts                      ← Next 16 (formerly middleware)

drizzle/0000_initial.sql         ← initial migration
docs/review-phase-1.md           ← this file
```

---

## Hand-off to Phase 2

Phase 2 trigger: user provisions bot token + DB + verifies live smoke test (`/start` → user + Inbox in DB; Mini App `/lists` shows Inbox).

Once smoke passes, switch to multi-agent mode per `handoff/specs/agents.md` "Phase 2 invocations":
1. **Architect-agent** [BLOCKING]: validate AI-agent's tool schemas, add `ToolCall` / `ConversationMessage` / `ItemSnapshot` types.
2. **AI-agent** + **Backend-agent** [PARALLEL]: 6 tools (create_item, search_items, update_item, complete_item, delete_item, list_lists) + executors + LLM router + conversation persistence + BYOK encryption.
3. **Frontend-agent** [PARALLEL]: item check toggle (optimistic), drag-reorder, item edit sheet, item delete confirm, settings page.
4. **Reviewer-agent** [BLOCKING]: lint + tsc + smoke + security pass.
