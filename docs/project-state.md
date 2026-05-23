# Project state

> Last refreshed: 2026-05-23 (Phase 17 hygiene pass).

## What ships today

listbull is a **Telegram-native AI to-do bot**. One Telegram chat
(DM or group) maps to one to-do context — items, reminders, memory,
secrets, activity log are all scoped to that chat.

### Surfaces

- **Telegram bot** — primary surface; webhook-driven, grammY-based.
- **Marketing landing** at `https://prod.listbull.org` — public
  product info, command reference, self-host pointer.
- **Security page** at `https://prod.listbull.org/security` —
  encryption + isolation guarantees with source permalinks.

There is no Mini App. The `(app)` route group was deleted in the
Phase 17 chat-only pivot; the project's product surface is the bot.

### Slash commands (12)

Order matches `setMyCommands` in `src/lib/server/bot/index.ts`:

| Command       | Purpose                                                         |
|---------------|-----------------------------------------------------------------|
| `/items`      | Open to-dos                                                     |
| `/done`       | Completed items (reopen / archive)                              |
| `/memory`     | Memory keepsakes (tickets, docs — never auto-deleted)           |
| `/tag <name>` | Items filtered by tag (e.g. `/tag burak`)                       |
| `/today`      | Today's items                                                   |
| `/thisweek`   | Items due this week                                             |
| `/reminders`  | Pending reminders                                               |
| `/password`   | Store / reveal passwords (DM-only save, group-aware reveal)     |
| `/settings`   | Language, notifications, formats, OpenRouter key                |
| `/onboarding` | Interactive 8-step walkthrough                                  |
| `/help`       | This message                                                    |
| `/reset`      | Clear conversation history                                      |

Implicit `/start` welcomes new users and offers the onboarding button.

### Capabilities beyond commands

- **Natural-language to-dos** — "süt al", "yarın 18'de fatura öde".
- **Checklist** — parent + sub-items. Parent completion is **gated**
  (cannot close while children are open); deletion cascade-archives
  children with explicit count confirmation.
- **Reminders** — natural language or button. Fire to the originating
  chat (group items → group; DM items → DM). Cron polls every 60s.
- **Voice notes** — transcribed via OpenRouter (Gemini 2.5 Flash);
  in DMs they go through the same item-capture path. In groups the
  bot listens ambiently — if a voice note contains a to-do, it's
  added; if not, the bot stays silent.
- **`/password`** — 3-step DM save (label → username → password),
  AES-256-GCM encrypted at rest. Reveal sends a 15-second self-
  destruct message with HTML `<code>` for tap-to-copy.
- **Memory** — long-lived keepsakes that never auto-archive (require
  explicit deletion).
- **Tag-based "assignment"** — `@buraksu42 raporu yap` creates an
  item tagged `#buraksu42`; `/tag buraksu42` filters to those.
- **BYOK + free-tier fallback** — users can paste their own
  OpenRouter key via `/settings`; if the operator has set
  `LISTBULL_SHARED_OPENROUTER_KEY`, keyless chats fall back to that
  with a free model (zero token cost).

## Stack

- Next.js 16 (App Router, Turbopack, TS strict)
- grammY (Telegram bot framework)
- Postgres 16 + Drizzle ORM
- OpenRouter via Anthropic SDK `baseURL` swap
- `next-intl` for TR/EN bot replies
- Tailwind v4 for the landing surface

Deployment: Dokploy on Hetzner; cron container runs `npm run cron`
every 60s.

## Active docs

- [`features.md`](./features.md) — feature reference
- [`self-host.md`](./self-host.md) — install runbook
- [`SMOKE_TEST.md`](./SMOKE_TEST.md) — e2e test matrix
- [`backlog.md`](./backlog.md) — future work

## Historical context

The pre-Phase-17 architecture (workspaces, lists, Mini App, Better
Auth, multi-bot, assignees) is preserved in
[`docs/archive/`](./archive/). Those documents do not reflect the
current implementation.
