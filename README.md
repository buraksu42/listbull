# listbull

> Telegram-native AI list assistant with persistent shared list memory.
> A chatty bot + Mini App, BYOK (bring-your-own OpenRouter key),
> open-source, self-hostable.

![demo](docs/demo.gif)

listbull lives where you already chat. Send a message ("Süt al", "tomorrow
9am go to the gym"), forward a recipe, share a list with your partner —
the bot extracts items, sets reminders, and gives you a clean Mini App
to drag, check off, and audit. No third-party LLM telemetry, no cloud
account: you bring an OpenRouter key, the bot uses it; you self-host the
DB, the data stays yours.

## Features

- **Conversational item capture** — natural language → action items via
  9 LLM tools (`create_item`, `search_items`, `update_item`,
  `complete_item`, `delete_item`, `list_lists`, `share_list`,
  `schedule_reminder`, `assign_item`).
- **Forwarded message extraction** — forward any Telegram message; the
  bot extracts up to 20 distinct action items in one round-trip.
- **Inline mode** — `@listbull_bot <query>` in any chat surfaces your
  10 most-recent matching items, deeplinkable.
- **Shareable list snapshots** — HMAC-signed read-only URLs (default
  30-day expiry) for any list. No DB-stored snapshot rows; the URL is
  the contract.
- **Cross-account sharing** — owner / editor / viewer roles, real-time
  invite acceptance, full activity log per list.
- **Audit log + 30-day restore** — owner-only `/lists/[id]/audit` page;
  any deleted item ≤30 days old is restorable in-place from
  `payload_before`.
- **Reminders** — natural-language scheduling (`schedule_reminder` tool
  + per-minute cron container). Idempotent dispatch; persistent-failure
  detection.
- **TR + EN at launch** — 151 keys parity (Inv-19 enforced via Vitest).
  Bot replies follow the user's `language_code`; LLM auto-detects mixed
  input.
- **Full data export** — `Settings → Download my data` returns a single
  JSON bundle (lists, items, activity, messages — caller-only filter,
  Inv-20). Optional Hetzner Object Storage signed URL when configured.
- **Accessibility-first Mini App** — keyboard navigation, ARIA labels,
  `prefers-reduced-motion` respected, focus rings on every interactive
  element.
- **BYOK encryption-at-rest** — your OpenRouter API key is encrypted
  with AES-256-GCM (Inv-8); plaintext is ephemeral and never logged.
- **No managed services** — Postgres, Next.js, cron in three Docker
  containers. Deploy on Hetzner, Fly, your laptop — same compose file.

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
