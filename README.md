# listbull

[![CI](https://github.com/buraksu42/listbull/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/buraksu42/listbull/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> **Telegram-native AI to-do bot. Every chat is its own list.**
> Bring your own OpenRouter key — or use the operator's free tier.
> Open source, self-hostable on a 5€ VPS.

[`prod.listbull.org`](https://prod.listbull.org) · [`@listbull_bot`](https://t.me/listbull_bot) · [Security](SECURITY.md) · [Self-host](docs/self-host.md)

---

listbull lives where you already chat. Send a message ("süt al",
"tomorrow 9am go to the gym"), forward a recipe, drop a voice note —
the bot extracts items, sets reminders, and keeps a tidy list per
chat. No Mini App, no third-party telemetry: the bot is the surface;
self-host the Postgres, the data stays yours.

## What it does

- **Conversational to-dos.** Natural language → action items. Forward
  any Telegram message; up to 20 items per turn.
- **Voice notes.** Transcribed via OpenRouter (Gemini 2.5 Flash).
  In groups the bot listens ambiently — to-dos surface, chatter
  doesn't.
- **Checklists.** "Haftalık temizlik: çamaşır, bulaşık, çöp" → parent
  + 3 children. Parent completion is **gated** until all children
  close. Cascade-delete with explicit count confirmation.
- **Reminders.** Natural language or button preset. Group items
  remind in the group; DM items remind in DM. Per-minute cron.
- **`/password`.** AES-256-GCM secret storage. 3-step DM save flow,
  group-aware reveal (15-second self-destruct message with HTML
  `<code>` for tap-to-copy).
- **Memory.** Long-lived keepsakes that never auto-archive (tickets,
  docs, receipts).
- **Tag-based assignment.** Mentioning a user creates a tag, not an
  owner. `/tag michael` filters to that tag's open items.
- **Interactive onboarding.** `/onboarding` walks through 8 features
  in a single edited message. Skip anytime.
- **BYOK + free tier.** Users paste their own OpenRouter key via
  `/settings`; if the operator sets `LISTBULL_SHARED_OPENROUTER_KEY`,
  keyless chats fall back to a free model.

## Slash commands

Order matches the Telegram menu (`setMyCommands` in
`src/lib/server/bot/index.ts`).

| Command         | Purpose                                              |
|-----------------|------------------------------------------------------|
| `/items`        | Open to-dos                                          |
| `/done`         | Completed items (reopen / archive)                   |
| `/memory`       | Memory keepsakes                                     |
| `/tag <name>`   | Items filtered by tag                                |
| `/today`        | Today's items                                        |
| `/thisweek`     | Items due this week                                  |
| `/reminders`    | Pending reminders                                    |
| `/password`     | Store / reveal passwords (DM)                        |
| `/settings`     | Language, notifications, formats, OpenRouter key     |
| `/onboarding`   | Interactive 8-step walkthrough                       |
| `/help`         | Command reference                                    |
| `/reset`        | Clear conversation history                           |

## Quickstart (self-host)

Full guide: [`docs/self-host.md`](docs/self-host.md). TL;DR:

```bash
git clone https://github.com/buraksu42/listbull.git && cd listbull
cp .env.example .env

# Fill .env — minimum: DATABASE_URL, ENV_KEY, TELEGRAM_BOT_TOKEN,
# TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME, NEXT_PUBLIC_APP_URL.
# Generate secrets with:
#   openssl rand -base64 32   # ENV_KEY
#   openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET

docker compose up -d
docker compose run --rm app npm run db:migrate

# Configure the bot — sets webhook + slash menu in one shot:
TELEGRAM_BOT_TOKEN="<token>" \
TELEGRAM_WEBHOOK_SECRET="<secret>" \
APP_BASE_URL="https://your-host.tld" \
  npm run setup:bot

# Then in BotFather: /setjoingroups Enable, /setprivacy Disable.
# Open Telegram → /start your bot. You're live.
```

## Stack

- **Bot framework**: grammY
- **Web**: Next.js 16 (App Router, TypeScript strict, Turbopack)
- **DB**: Postgres 16 + Drizzle ORM
- **LLM gateway**: OpenRouter (via the Anthropic SDK with `baseURL`
  swapped)
- **i18n**: `next-intl` (TR / EN for bot replies)
- **Deployment**: Docker Compose (`postgres` + `app` + `cron`). Runs
  fine on Hetzner / Fly / your laptop / Dokploy.

Cron container loops `npm run cron` every 60s for reminder dispatch.

## Security

Short version: `/password` and BYOK API keys are AES-256-GCM
encrypted at rest; every database query is scoped to the Telegram
`chatId`; callback handlers verify chat ownership before any
mutation; the webhook authenticates with a constant-time secret
comparison.

Full audit with source permalinks: [`SECURITY.md`](SECURITY.md).

## Data flow

- **Where data lives**: your Postgres. The bot makes outbound calls
  only to (a) Telegram (the chat surface) and (b) OpenRouter (the
  LLM turn).
- **Encryption at rest**: secrets and BYOK keys via AES-256-GCM
  (`ENV_KEY`). Plaintext exists only in process memory for the
  duration of a single operation.
- **No telemetry by default**: Sentry + Umami are opt-in via build
  args. Without those, no events leave the host.
- **Self-host operators are the GDPR data controller**. The bot
  provides tooling (export, audit log); the operator owns the
  policy.

## Development

```bash
npm install
cp .env.example .env.local       # fill DEV values; chmod 600

npm run dev                      # Next.js on :3000 with Turbopack
npm run db:generate              # after any schema.ts edit
npm run db:migrate               # apply migrations
npm run db:studio                # Drizzle Studio (DB browser)

npm run lint                     # ESLint
npm run typecheck                # tsc --noEmit
npm test                         # Vitest (currently no live tests)

npm run cron                     # one-shot reminder dispatch tick
```

## Repo layout

```
src/
  app/
    (marketing)/        # public landing + /security page
    api/                # webhook + /api/health
  components/marketing/ # landing components
  lib/
    ai/                 # LLM tools + prompts + conversation slicing
    auth/               # session HMAC (dormant post-Phase-17)
    cron/               # reminder dispatcher
    db/                 # schema, queries, snapshots
    server/             # bot handlers, tool executors, encryption
    types/              # shared types
    validators/         # zod schemas
docs/
  features.md           # feature reference
  self-host.md          # install runbook
  SMOKE_TEST.md         # e2e test matrix
  project-state.md      # what ships today
  archive/              # pre-Phase-17 historical docs (do not trust)
SECURITY.md             # encryption + isolation guarantees
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE) © 2026 Burak Sungu. Use it, fork it, ship it.

---

Questions? Open an issue or DM
[@buraksu42](https://github.com/buraksu42) on GitHub.
