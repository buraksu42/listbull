# listbull — Claude Code Context

> Stack/infra/CI/secrets/git/monitoring defaults: see `~/.claude/CLAUDE.md`.
> Brand + design tokens live in `handoff/`; everything else (architecture, schema, agents) is in the repo itself.

## What it is

Telegram-native AI list assistant — chatty bot only, no Mini App.
Bring-your-own-key (BYOK) AI via OpenRouter. Open source, self-hostable.

Primary persona: power Telegram user (Turkish/English, mobile-first).

## Type & domain

- Type: **flagship** (umbrella domain `listbull.org`, OSS public product)
- **Project home (apex)**: `https://listbull.org` — open-source project info / install docs (separate static site, not in this codebase; built from a sibling repo or simple GitHub Pages)
- **Production app**: `https://prod.listbull.org` — canonical hosted instance of the listbull bot + marketing site
- **Test/staging**: `https://test.listbull.org`
- **Tenant pattern**: `https://<tenant>.listbull.org` — additional self-host instances on the same infra (e.g. `loyetta.listbull.org`). Same code, env-driven `NEXT_PUBLIC_APP_URL` + dedicated `DATABASE_URL` per tenant.
- **Bot**: `@listbull_bot` for prod (fallback `@listbull_app_bot`); separate test bot for `test.` (e.g. `@listbull_test_bot`); per-tenant bots for tenant deployments.
- DNS: pending (post-deploy).

## Project-specific tech (extends Stack Defaults)

- **Auth**: none for the surface — Telegram identity is the auth, verified via webhook secret token. No session cookies, no Better Auth, no login UI.
- **DB**: chat-pivot schema (`users`, `chats`, `chat_members`, `items`, `item_reminders`, `item_attachments`, `messages`, `activity_log`, `bot_action_contexts`, `pending_secret_deletions`). Drizzle ORM.
- **AI/LLM**: OpenRouter via Anthropic SDK `baseURL` swap. **BYOK per chat** — keys encrypted at rest with AES-256-GCM (`ENV_KEY`). Default model `anthropic/claude-haiku-4.5`.
- **Email**: none — notifications via Telegram DM.
- **i18n**: TR + EN via `next-intl` (marketing site only). Bot replies driven by `users.locale`.
- **Cron**: Dokploy cron container, every 60s, scans due reminders + sweeps pending secret deletions.
- **Extras**: `grammY` (bot framework), `rrule` (recurrence), `next-intl` (marketing i18n).

## Folder structure

Two route groups:
- `(marketing)` — public landing, **light-only**, indexable
- `(ops)` — brand-owner dashboard, basic-auth gated via `src/middleware.ts`, `noindex`

Agent ownership boundaries (enforced via folder, never cross):
- `src/lib/types/**` — Architect (frozen after Phase 1)
- `src/lib/db/**`, `src/lib/server/**`, `src/lib/cron/**`, `src/lib/validators/**`, `src/app/api/**` — Backend
- `src/lib/ai/**` — AI-agent (schemas only; executors live in `src/lib/server/tools/**` owned by Backend)
- `src/app/(marketing)/**`, `src/components/marketing/**` — Frontend (landing only)

## Commands

- `npm run dev` — Next.js dev server (Turbopack)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — `drizzle-kit generate` (after schema change)
- `npm run db:migrate` — apply migrations to current `DATABASE_URL`
- `npm run db:studio` — Drizzle Studio
- `npm run cron` — manual cron run (local testing — Phase 3+)

## Architecture (skim)

- Single Next.js app: bot webhook (`POST /api/telegram/webhook`) + public marketing site + brand-owner `/ops` dashboard. No Mini App, no client-side state, no session cookies.
- Webhook ack 200 within 60s; defer LLM work via `setImmediate`/`waitUntil`, then `sendMessage`.
- LLM tool layer: zod-typed tools, every executor wraps in a single Drizzle transaction + writes `activity_log`.
- Activity log doubles as audit/restore source — `payload_before` / `payload_after` JSONB.
- Bot uses `users.locale` (TR / EN) for replies; marketing site is English-only.

## Status

**Phase 17 chat-only pivot is the current architecture.** Each Telegram chat (DM or group) is its own to-do context — no workspaces, no Mini App. New work lands as ordinary git commits / PRs (dev → main, Dokploy auto-deploys). See `docs/project-state.md` for the historical pre-pivot architecture.

## Project-specific gotchas

- **Bot username squatting**: confirm `@listbull_bot` via BotFather before deploy; fall back `@listbull_app_bot`.
- **Webhook secret rotation**: verify `X-Telegram-Bot-Api-Secret-Token` on every request; rotate via env redeploy.
- **Telegram message cap = 4096 chars** — chunk on word boundaries.
- **MarkdownV2 escaping**: use grammY's `formatter` helper, never raw concat.
- **Cron timezone**: Dokploy cron runs UTC; reminder comparisons UTC-consistent, user TZ is presentation only.
- **Webhook handler must respond 200 within 60s** — ack first, do LLM work after.
- **BYOK encryption**: AES-256-GCM via `ENV_KEY`. Rotation = all stored keys unreadable; re-prompt users.
- **Tool execution is transactional** — half-applied state breaks the audit log.

## Links

- GitHub: https://github.com/buraksu42/listbull
- Test: https://test.listbull.org
- Prod: https://prod.listbull.org
- Brand assets: `handoff/brand/` (logo SVG + PNG)
- Design tokens: `handoff/tokens/`
