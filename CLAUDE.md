# listgram — Claude Code Context

> Stack/infra/CI/secrets/git/monitoring defaults: see `~/.claude/CLAUDE.md`.
> Full handoff (research, architecture, agents plan, design, brand, tokens, interactive prototype):
> `handoff/` is the single source of truth.

## What it is

Telegram-native AI list assistant with persistent shared list memory.
A Telegram Mini App + chatty bot, with bring-your-own-key (BYOK) AI via OpenRouter.
Open source, self-hostable.

Primary persona: power Telegram user (Turkish/English, mobile-first).

## Type & domain

- Type: **flagship** (own domain, OSS public product)
- Prod: `https://www.listgram.net`
- Test: `https://test.listgram.net`
- Bot: `@listgram_bot` (fallback: `@listgram_app_bot` — check BotFather pre-deploy)
- Mini App URL: `https://www.listgram.net/app`
- DNS: pending (post-deploy)

## Project-specific tech (extends Stack Defaults)

- **Auth**: Better Auth + custom Telegram initData plugin (HMAC-SHA256). Telegram-only — no email, no OAuth.
- **DB**: 7 tables (`users`, `lists`, `list_members`, `items`, `messages`, `list_invites`, `activity_log`). Drizzle ORM.
- **AI/LLM**: OpenRouter via Anthropic SDK `baseURL` swap. **BYOK per user** — keys encrypted at rest with AES-256-GCM (`ENV_KEY`). Default model `anthropic/claude-sonnet-4`.
- **Email**: none in Phase 1 (Resend in Stack Defaults but unused — notifications via Telegram DM).
- **i18n**: TR + EN via `next-intl`. **No URL prefix** — locale driven by `users.locale` server-side.
- **Cron**: Dokploy cron container, every 60s, scans due reminders.
- **Real-time**: 5s polling via TanStack Query (no websockets in Phase 1).
- **Extras**: `grammY` (bot framework), `@telegram-apps/sdk-react` (Mini App SDK), `@dnd-kit/core` (drag-reorder).

## Folder structure

Two route groups:
- `(marketing)` — public landing, **light-only**, no theme adapter, indexable
- `(app)` — Mini App, Telegram theme adapter, auth-gated via middleware, `noindex`

Agent ownership boundaries (enforced via folder, never cross):
- `src/lib/types/**` — Architect (frozen after Phase 1)
- `src/lib/db/**`, `src/lib/server/**`, `src/lib/auth/**`, `src/lib/cron/**`, `src/lib/validators/**`, `src/app/api/**` — Backend
- `src/lib/ai/**` — AI-agent (schemas only; executors live in `src/lib/server/tools/**` owned by Backend)
- `src/app/(app)/**`, `src/app/(marketing)/**`, `src/components/**`, `src/hooks/**`, `src/lib/telegram/**` — Frontend

Full tree + naming: `handoff/specs/CLAUDE.md`.

## Commands

- `npm run dev` — Next.js dev server (Turbopack)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — `drizzle-kit generate` (after schema change)
- `npm run db:migrate` — apply migrations to current `DATABASE_URL`
- `npm run db:studio` — Drizzle Studio
- `npm run cron` — manual cron run (local testing — Phase 3+)

## Architecture (skim — full spec in handoff)

- Single Next.js app, dual surface: bot webhook (`POST /api/telegram/webhook`) + Mini App (`/app/...`).
- Webhook ack 200 within 60s; defer LLM work via `setImmediate`/`waitUntil`, then `sendMessage`.
- LLM tool layer: 9 zod-typed tools, every executor wraps in a single Drizzle transaction + writes `activity_log`.
- Activity log doubles as audit/restore source — `payload_before` / `payload_after` JSONB.
- Bot uses `users.locale` for replies; Mini App reads Telegram theme at runtime, single accent `#00D9C0`.

## Phase status

**Phase 1 (Foundation) — IN PROGRESS** · single-session per `handoff/specs/agents.md`.

Scope: scaffold + 7-table schema + initData auth + read-only Mini App + `/start /help /lists` slash commands. Verification: pragmatic gate (lint + tsc + dev boot; live smoke deferred — bot token + DB still pending).

Phases 2-5 use multi-agent roster (Architect, Backend, Frontend, AI, Reviewer) — see `handoff/specs/agents.md` for per-phase invocation prompts.

## Project-specific gotchas

- **Bot username squatting**: confirm `@listgram_bot` via BotFather before deploy; fall back `@listgram_app_bot`.
- **Webhook secret rotation**: verify `X-Telegram-Bot-Api-Secret-Token` on every request; rotate via env redeploy.
- **initData expires in 24h** (Telegram convention) — re-issue session on fresh initData.
- **Telegram message cap = 4096 chars** — chunk on word boundaries.
- **MarkdownV2 escaping**: use grammY's `formatter` helper, never raw concat.
- **Cron timezone**: Dokploy cron runs UTC; reminder comparisons UTC-consistent, user TZ is presentation only.
- **Webhook handler must respond 200 within 60s** — ack first, do LLM work after.
- **BYOK encryption**: AES-256-GCM via `ENV_KEY`. Rotation = all stored keys unreadable; re-prompt users.
- **No localStorage / DeviceStorage for state** — backend owns state, frontend renders.
- **Tool execution is transactional** — half-applied state breaks the audit log.

## Links

- GitHub: https://github.com/buraksu42/listgram
- Test: https://test.listgram.net
- Prod: https://www.listgram.net
- Handoff (canonical): `handoff/`
- Agent plan (Phase invocations): `handoff/specs/agents.md`
- Interactive design reference: `handoff/design-reference/listgram (standalone).html`
