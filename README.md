# listbull

[![CI](https://github.com/buraksu42/listbull/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/buraksu42/listbull/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Telegram-native AI list assistant with persistent shared list memory.
> A chatty bot + Mini App, BYOK (bring-your-own OpenRouter key),
> open-source, self-hostable. Free for solo, paid for your group.

![demo](docs/demo.gif)

listbull lives where you already chat. Send a message ("Süt al", "tomorrow
9am go to the gym"), forward a recipe, share a list with your partner —
the bot extracts items, sets reminders, and gives you a clean Mini App
to drag, check off, and audit. No third-party LLM telemetry, no cloud
account: you bring an OpenRouter key, the bot uses it; you self-host the
DB, the data stays yours.

## Features

### Capture + organize
- **Conversational item capture** — natural language → action items
  ("yarın 9'da diş hekimi", "süt al, akşam hatırlat").
- **Forwarded message extraction** — forward any Telegram message;
  the bot extracts up to 20 distinct action items in one round-trip.
- **Voice → STT** — voice notes get transcribed (Gemini Flash via
  OpenRouter) and processed through the same item-capture path.
- **Photo / video / document attachments** — bot uploads land on the
  current item; Mini App lightbox plus "Telegram'a yolla" fallback
  if the byte-proxy can't preview.
- **Inline mode** — `@your_bot <query>` in any chat surfaces your
  10 most-recent matching items, deeplinkable.

### Lists + workspaces
- **Workspaces** — multi-user containers with `owner` / `admin` /
  `editor` / `viewer` / `guest` roles. Invite via username; members
  share lists, items, reminders, activity log.
- **Lists per workspace** — owner / editor / viewer per-list roles
  layered on top of workspace membership.
- **Item discipline** — status (open/in_progress/blocked/done),
  priority (low/normal/high), workspace-scoped tags, deadlines.
- **Kanban view** — drag-and-drop board per list AND workspace-wide
  (`/views/board`) with priority + assignee filter chips.
- **Today / Week / Board smart views** — cross-list aggregations
  from the workspace home.
- **Assignees** — owners + members can assign items to any list
  member (Inv-12).
- **Task-level recurrence** — RRULE on `items.task_recurrence_rule`;
  completed item auto-resurrects with the next occurrence.

### Reminders + sharing
- **Reminders** — natural-language scheduling, multiple per item,
  absolute or offset-from-deadline, RRULE recurrence on the reminder.
  Per-minute cron dispatch.
- **Shareable list snapshots** — HMAC-signed read-only URLs (default
  30-day expiry).
- **Cross-account sharing** — invite tokens with 7-day TTL, DM
  delivery via the bot.
- **Audit log + 30-day restore** — `/lists/[id]/audit`; any deleted
  item ≤30 days old is restorable in-place from `payload_before`.

### Self-host first
- **No managed services** — Postgres, Next.js, cron, optional Upstash.
  Deploy on Hetzner, Fly, your laptop — same compose file.
- **BYOK encryption-at-rest** — OpenRouter API keys encrypted with
  AES-256-GCM. Plaintext ephemeral, never logged.
- **Three key-resolution modes** — user BYOK, workspace org-key, or
  operator-mode env-key (only for workspaces owned by
  `OPERATOR_TELEGRAM_ID`).
- **Multi-bot** — workspace owner registers their own white-label
  Telegram bot via BotFather; reminders + invites route through it.
- **Full data export** — `Settings → Download my data` returns JSON
  bundle. Optional Hetzner Object Storage signed URL when configured.
- **TR + EN parity** — 151+ keys (Inv-19 enforced via Vitest).
- **No third-party telemetry by default** — Sentry / Umami opt-in via
  env vars; absent those, no events leave the box.

### Operations
- **Stale-data cleanup cron** — prunes expired invites + activity log
  rows >90 days old.
- **Extended `/api/health`** — db + bot required (200/503), redis
  optional, surfaces degraded mode.
- **Upstash KV** — webhook idempotency + per-route rate limit when
  configured.
- **Per-user bot rate limit** — `LISTBULL_PER_USER_HOURLY_MSG_LIMIT`.
- **Accessibility-first Mini App** — keyboard navigation, ARIA labels,
  `prefers-reduced-motion` respected, focus rings everywhere.

## Quickstart (self-host)

**Full step-by-step guide**: [`docs/self-host.md`](docs/self-host.md)
— ~30 minutes, end-to-end (bot creation → reverse proxy → migrations
→ smoke test → optional Sentry/Umami).

TL;DR for the impatient:

```bash
git clone https://github.com/buraksu42/listbull.git && cd listbull
cp .env.example .env
# Fill .env (see docs/self-host.md for every field + how to generate
# secrets). Minimum: DATABASE_URL, BETTER_AUTH_SECRET, ENV_KEY,
# TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME,
# NEXT_PUBLIC_APP_URL, BETTER_AUTH_URL.

docker compose up -d
docker compose run --rm app npm run db:migrate

# Configure @BotFather: /setdomain, /setmenubutton, /setinline.
# Then set the webhook (replace TOKEN + SECRET):
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://your-host.tld/api/telegram/webhook","secret_token":"<SECRET>"}'

# /start the bot in Telegram → Inbox appears in Mini App.
```

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript strict mode)
- **DB**: Postgres 16 + Drizzle ORM
- **Auth**: Better Auth (custom Telegram Mini App initData plugin)
- **LLM gateway**: OpenRouter (Anthropic SDK; provider-neutral
  tool-calling)
- **Telegram**: grammY (webhook + inline + commands)
- **UI**: shadcn/ui primitives, Tailwind v4, `@telegram-apps/sdk-react`
- **Cron**: standalone `tsx` container, run by Dokploy / docker-compose
- **i18n**: `next-intl` (TR/EN parity enforced in CI)

Architecture deep-dive: [`handoff/specs/architecture.md`](handoff/specs/architecture.md)
| Phase contracts: [`docs/architecture-pass-phase-{1,2,3,4}.md`](docs/)

## Data flow / GDPR

- **Where data lives**: your Postgres. listbull makes zero outbound
  calls except (a) Telegram (because that's the chat surface) and
  (b) OpenRouter via the user's BYOK key for the LLM turn.
- **Retention**: until the user exports + deletes (F1). No automatic
  pruning; messages are append-only (Inv-7).
- **Encryption-at-rest**: BYOK API keys are AES-256-GCM encrypted
  before going to disk (Inv-8). Plaintext exists only for the duration
  of a single LLM call.
- **No third-party telemetry by default**. Sentry + Umami integration
  is opt-in via `NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_UMAMI_WEBSITE_ID`
  env vars; absent those, no events leave the box.
- **Self-host operators are the GDPR data controller**. listbull
  provides the tooling (export, restore, audit log); the operator owns
  the policy.

## Development

```bash
npm install
cp .env.example .env.local       # fill DEV values; chmod 600 .env.local

npm run dev                      # Next.js on :3000 with Turbopack
npm run db:generate              # after any schema.ts edit
npm run db:migrate               # apply migrations
npm run db:studio                # Drizzle Studio (DB browser)

npm run lint                     # ESLint
npm run typecheck                # tsc --noEmit
npm test                         # Vitest unit suite
npm run e2e                      # Playwright (live tests behind LISTBULL_E2E_LIVE=1)

# Cron container (separate process, every 60s in docker-compose)
npm run cron                     # one-shot dispatch tick
```

## Project structure

```
src/
  app/                    # Next.js App Router routes
    (app)/                  # auth-gated Mini App pages
    (marketing)/            # public landing + snapshot pages
    api/                    # webhook + REST endpoints
  components/             # UI primitives + features
  lib/
    ai/                     # LLM tools + prompts + conversation slicing
    auth/                   # Better Auth + Telegram Mini App plugin
    cron/                   # reminder dispatcher (standalone tsx)
    db/                     # schema, queries, snapshots
    server/                 # business logic (executors, export, restore, …)
    types/                  # shared types (Architect-owned, frozen)
    validators/             # zod schemas + response types
handoff/specs/            # canonical architecture / engineering docs
docs/                     # phase contracts + review reports
tests/
  unit/                     # Vitest
  e2e/                      # Playwright
```

## Tips & tricks

- **Schedule a message** — Telegram natively supports scheduled DMs.
  Long-press the send button → Schedule Message. The bot processes it
  exactly when delivered; no special server-side handling needed.
- **Forward to capture** — forward any message to the bot and it'll
  extract up to 20 action items. Receipts, recipes, meeting notes —
  whatever has a discrete-action shape.
- **Inline mode** — type `@your_bot todo` in any Telegram chat to
  surface your matching items as inline cards.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues + PRs welcome; check
the project's agent-ownership boundaries in
[`handoff/specs/agents.md`](handoff/specs/agents.md) before refactoring
across `src/lib/ai/`, `src/lib/server/`, `src/app/`.

## License

[MIT](LICENSE) © 2026 Burak Sungu. Use it, fork it, ship it.

## Acknowledgments

Inspiration drawn from [listOK](https://www.listok.app),
[ToBeDo](https://tobedo.app), and the long lineage of Telegram task
bots — see [`handoff/specs/research.md`](handoff/specs/research.md)
for the full survey.

---

Questions? Open an issue or DM [@buraksu](https://github.com/buraksu42)
on GitHub.
