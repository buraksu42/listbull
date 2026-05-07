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

### Core (Phase 1–4)
- **Conversational item capture** — natural language → action items.
- **Forwarded message extraction** — forward any Telegram message;
  the bot extracts up to 20 distinct action items in one round-trip.
- **Inline mode** — `@listbull_bot <query>` in any chat surfaces your
  10 most-recent matching items, deeplinkable.
- **Shareable list snapshots** — HMAC-signed read-only URLs (default
  30-day expiry).
- **Cross-account sharing** — owner / editor / viewer roles, real-time
  invite acceptance, full activity log per list.
- **Audit log + 30-day restore** — `/lists/[id]/audit` page;
  any deleted item ≤30 days old is restorable in-place from
  `payload_before`.
- **Reminders** — natural-language scheduling + per-minute cron.
- **TR + EN at launch** — 151+ keys parity (Inv-19 enforced via Vitest).
- **Full data export** — `Settings → Download my data` returns JSON
  bundle. Optional Hetzner Object Storage signed URL when configured.
- **BYOK encryption-at-rest** — OpenRouter API key encrypted with
  AES-256-GCM. Plaintext ephemeral, never logged.

### Workspaces + billing (Phase 4.5–5)
- **Workspaces** — Personal + shared (Team / Workspace tier). Members,
  per-workspace roles, scoped lists.
- **Item discipline** — status (open/in_progress/blocked/done),
  priority (low/normal/high), workspace-scoped tags. Filter chips on
  the list page.
- **Multi-bot** — Workspace-tier admins register their own white-label
  Telegram bot via BotFather; reminder dispatch routes through it,
  fallback to default platform bot.
- **24 LLM tools** — Phase 1's 9 tools + 6 workspace tools
  (switch_workspace, list_workspaces, update_workspace,
  invite_to_workspace, remove_workspace_member, set_item_attributes)
  + cancel_invite, list_members, remove_member, update_member_role,
  update_settings, create_list, update_list, delete_list,
  restore_list.
- **Stripe + Iyzico billing** — provider routed by user locale (TR
  → Iyzico, else Stripe). Webhook idempotency via Upstash KV.
- **Workspace org-key** — admin sets a workspace-wide OpenRouter key;
  members without personal BYOK fall back to it.

### Self-host license + admin (Phase 6)
- **Ed25519 license JWT** — issued by SaaS, verified offline by
  self-host instances. Workspace-bound payload; revocation list
  fetched periodically.
- **Workspace admin dashboard** — `/workspace/admin` for Workspace-
  tier owner/admin: usage stats, activity timeline, bulk-restore,
  spend telemetry.

### Telemetry + cost (Phase 7–9)
- **LLM usage tracking** — every turn writes to `llm_usage` with
  cost (provider-reported via OpenRouter `usage.cost` when present;
  client-side rate card otherwise). Per-workspace + per-member +
  per-model rollups on the admin dashboard.
- **Spend trend sparkline** — 30-day daily token totals + projection
  (non-zero-day average × 30).
- **Per-member spend caps** — workspace admin sets daily/monthly USD
  caps on org-key usage. Personal BYOK bypasses caps.
- **Per-user bot rate limit** — `LISTBULL_PER_USER_HOURLY_MSG_LIMIT`
  env-gated.

### Operations (Phase 10)
- **Stale-data cleanup cron** — prunes expired invites + activity
  log past tier retention (free=30d, team=90d, workspace=unlimited).
- **Extended `/api/health`** — db + bot required (200/503), redis +
  stripe optional with degraded surface.
- **Upstash KV** — webhook idempotency + per-route rate limit (admin
  endpoints + billing checkout) when configured.

### Infrastructure
- **No managed services** — Postgres, Next.js, cron, optional Upstash.
  Deploy on Hetzner, Fly, your laptop — same compose file.
- **Accessibility-first Mini App** — keyboard navigation, ARIA labels,
  `prefers-reduced-motion` respected, focus rings everywhere.

## Quickstart (self-host)

You'll need: Docker (with Compose), a Telegram bot token from
[@BotFather](https://t.me/BotFather), and ~15 minutes.

```bash
# 1. Clone
git clone https://github.com/buraksu42/listbull.git
cd listbull

# 2. Configure secrets
cp .env.example .env
# Edit .env. Minimum required:
#   DATABASE_URL=postgres://listbull:listbull@postgres:5432/listbull
#   BETTER_AUTH_SECRET=$(openssl rand -base64 48)
#   BETTER_AUTH_URL=https://your-host.tld   # public URL
#   ENV_KEY=$(openssl rand -base64 32)
#   TELEGRAM_BOT_TOKEN=<from @BotFather>
#   TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
#   TELEGRAM_BOT_USERNAME=<your_bot_without_@>
#   NEXT_PUBLIC_APP_URL=https://your-host.tld

# 3. Bring up the stack (Postgres + app + cron)
docker compose up -d
docker compose logs -f app   # wait for "Ready on :3000"

# 4. Run migrations (one-shot)
docker compose run --rm app npm run db:migrate
# Phase 4.5+ also requires a one-time data backfill:
docker compose run --rm app npx tsx \
  src/lib/server/migrations/workspace-pivot.ts

# 5. Wire your bot
#    a. Open https://your-host.tld in a browser — you'll see the Mini App.
#    b. Tell BotFather:
#         /setdomain  → your-host.tld
#         /setjoingroups  → Disable
#         /setinline   → Enable, placeholder "Search items…"
#         /setmenubutton  → Web App  → https://your-host.tld/app
#    c. Set the webhook (one-time, run on your laptop):
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://your-host.tld/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET from .env>",
    "drop_pending_updates": true,
    "allowed_updates": ["message","inline_query","callback_query"]
  }'

# 6. Send /start to your bot in Telegram → an Inbox is created;
#    open the Mini App from the menu button to confirm.
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
