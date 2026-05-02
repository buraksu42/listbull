# listbull — Claude Code Context

> Stack/infra/CI/secrets/git/monitoring defaults: see `~/.claude/CLAUDE.md`.
> Full handoff (research, architecture, agents plan, design, brand, tokens, interactive prototype):
> `handoff/` is the single source of truth.

## What it is

Telegram-native AI list assistant with persistent shared list memory.
A Telegram Mini App + chatty bot, with bring-your-own-key (BYOK) AI via OpenRouter.
Open source, self-hostable.

Primary persona: power Telegram user (Turkish/English, mobile-first).

## Type & domain

- Type: **flagship** (umbrella domain `listbull.org`, OSS public product)
- **Project home (apex)**: `https://listbull.org` — open-source project info / install docs (separate static site, not in this codebase; built from a sibling repo or simple GitHub Pages)
- **Production app**: `https://prod.listbull.org` — canonical hosted instance of the listbull Mini App + bot
- **Test/staging**: `https://test.listbull.org`
- **Tenant pattern**: `https://<tenant>.listbull.org` — additional self-host instances on the same infra (e.g. `loyetta.listbull.org`). Same code, env-driven `NEXT_PUBLIC_APP_URL` + dedicated `DATABASE_URL` per tenant.
- **Bot**: `@listbull_bot` for prod (fallback `@listbull_app_bot`); separate test bot for `test.` (e.g. `@listbull_test_bot`); per-tenant bots for tenant deployments.
- **Mini App URL** (BotFather setMenuButton target): `https://prod.listbull.org/app` (or matching subdomain).
- DNS: pending (post-deploy).

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

**Phases 1-5 — SHIPPED** on `dev` branch. Code-side complete; live launch is a manual user action per `docs/launch-checklist-phase-5.md`.

| Phase | Commit | Result |
|---|---|---|
| 1 — Foundation | `c33e51f` | scaffold + 7-table schema + initData auth + read-only Mini App + slash commands |
| 2 — Core LLM + manage | `6632cd9` | 6 LLM tools + executors + bot router + items API + BYOK encryption |
| 3 — Sharing + reminders + assignments | `94f9bf0` | 3 more tools + invite flow + cron + activity feed + member mgmt |
| 4 — OSS quality + enhancements | `d435b0e` | A3/D1/D2/F1/F2 + i18n + a11y + Vitest 63/63 + Playwright config + README + LICENSE + CONTRIBUTING + docker-compose |
| 5 — Launch prep | `b2d9753` (+ `f843e89` cron hotfix) | robots.ts + noindex + standalone build + launch runbook |

Multi-agent roster (Architect, Backend, Frontend, AI, Reviewer) — see `handoff/specs/agents.md` for per-phase invocation prompts. Future ad-hoc work uses normal git workflow (no orchestrator-driven phase machinery).

## Project-specific gotchas

- **Bot username squatting**: confirm `@listbull_bot` via BotFather before deploy; fall back `@listbull_app_bot`.
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

- GitHub: https://github.com/buraksu42/listbull
- Test: https://test.listbull.org
- Prod: https://prod.listbull.org
- Handoff (canonical): `handoff/`
- Agent plan (Phase invocations): `handoff/specs/agents.md`
- Interactive design reference: `handoff/design-reference/listbull (standalone).html`
