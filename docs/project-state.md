# listbull — project state

> Single-page summary of every phase. Updated 2026-05-06.
> For technical details see `architecture-overview.md` + the
> phase-specific architect-pass docs.

## Status: shipped through Phase 12

| Phase | Title | Status | Commit landmark |
|---|---|---|---|
| 1 | Foundation | Complete | (pre-Phase-4.5) |
| 2 | Core LLM + tools | Complete | architect-pass-phase-2.md |
| 3 | Sharing + reminders + assignments | Complete | architect-pass-phase-3.md |
| 4 | OSS quality polish | Complete | architect-pass-phase-4.md |
| 4.5 | Workspace + billing + multi-bot pivot | Complete | `22b3a2c` BLOCKER 0 |
| 5 | SaaS launch + billing + multi-bot wiring | Complete | `35d94cb` handoff |
| 5.5 | Org-key + workspace invitations + bot LRU | Complete | `882f025` |
| 6 | Self-host JWT license + admin dashboard | Complete | `bc6a012` |
| 6.5 | Activity timeline + email + auto-issuance + bulk restore | Complete | `16fc18b` |
| 7 | Item filters + LLM telemetry + Upstash KV | Complete | `22663af` |
| 8 | Cost extraction + sparkline + member caps | Complete | `32512e3` |
| 9 | Cost projection + provider cost + i18n | Complete | `1056986` |
| 10 | Bot rate limit + cleanup cron + extended health | Complete | `1fa2128` |
| 11 | README refresh + architecture overview | Complete | `daee607` |
| 12 | Public-ready repo + this doc | Complete | this commit |

## Numbers at end of Phase 12

- **18 tables** (7 from Phase 1 + 11 added across Phases 4.5–8)
- **24 LLM tools** (9 from Phase 1–3 + 15 added across Phases 3–4.5)
- **6 Drizzle migrations** (`0001_nebulous_revanche` →
  `0006_late_valeria_richards`)
- **2 cron jobs** (reminders, cleanup-stale)
- **2 system prompts versioned** (v3 + v4); v1, v2, v3 retained for rollback
- **5 billing/license env keypairs** (Stripe, Iyzico, Upstash, Resend,
  License keypair) — all optional with safe-default no-ops
- **78 unit tests** (Vitest), 1 skipped
- **CI surface**: lint + tsc + Vitest + Playwright + gitleaks, all green

## Surfaces

### Bot (Telegram)
- Default platform `@listbull_bot` + Workspace-tier white-label bots
- 5 slash commands: `/start`, `/lists`, `/share`, `/snapshot`,
  `/help`, `/reset`
- Inline mode `@listbull_bot <query>` (Phase 4)
- Forwarded message extraction (Phase 4)
- 24-tool LLM router via system.v4 prompt
- Per-user hourly rate limit (Phase 10)

### Mini App (Telegram WebApp)
- `/lists` — list-of-lists with workspace switcher header
- `/lists/[id]` — items with status badge / priority dot / tag chips
  + filter chips (Phase 7)
- `/lists/[id]/activity` — per-list activity feed (Phase 3)
- `/lists/[id]/audit` — owner-only restore (Phase 4)
- `/views/today` — workspace-scoped due-today aggregate (Phase 4.5)
- `/workspace/settings` — Plan card, members, custom bot, org-key
- `/workspace/admin` — Workspace-tier admin: usage stats, spend +
  sparkline, caps, activity timeline, bulk restore
- `/workspace/new` — create workspace
- `/billing/success` — post-checkout landing
- `/invites/[token]` — per-list invite accept (Phase 3)
- `/workspace-invites/[token]` — workspace invite accept (Phase 5.5)
- `/settings` — BYOK key, locale, timezone, model, notifications,
  30-day usage badge, workspace cap visibility (Phase 9)

### API routes
- `/api/auth/telegram` — Mini App initData verification
- `/api/telegram/webhook[/botId]` — bot updates (default + per-bot)
- `/api/lists/*` — list/item CRUD
- `/api/workspaces/*` — workspace CRUD + members + bots + caps + activity
- `/api/billing/{checkout,portal,subscription}` — Stripe + Iyzico
- `/api/webhooks/{stripe,iyzico}` — provider lifecycle
- `/api/admin/licenses[/[id]]` — license issuance + revoke (operator-token)
- `/api/license-revocations` — public newline-separated revoked IDs
- `/api/health` — db + bot required, redis + stripe optional

## Operator handoff index

| Doc | Phase | Topic |
|---|---|---|
| `phase-5-handoff.md` | 5 | SaaS launch operator runbook (Stripe + Iyzico keys, BotFather, repo public, prod cutover) |
| `phase-6-handoff.md` | 6 | Self-host license keypair + admin endpoints + revocation list |
| `architecture-pass-phase-4.5.md` | 4.5 | Workspace pivot schema + types + migration runbook |
| `review-phase-4.5.md` | 4.5 | Reviewer strict-gate findings |
| `architecture-overview.md` | All | Top-level surface map + invariants |

## What's NOT shipped (intentional)

These are out of scope per the project's "Telegram-native AI list
assistant" wedge — listed here so contributors know not to PR them:

- **Project management features** — Gantt, dependencies, custom
  fields, multi-assignee, custom workflows, time tracking
- **Real-time chat** — Slack/Discord-style; we route through Telegram
- **iOS/Android native apps** — Mini App + Telegram covers mobile
- **Email digests** — license email is the only Resend usage
- **OpenRouter alternatives** — model providers stay BYOK via
  OpenRouter routing
- **Live phone-home license verification** — privacy-first;
  revocation list is the offline mechanism

## Maintenance mode

After Phase 12 the project enters maintenance:

- Bug fixes welcome via PR
- Feature requests gated by anti-list (issue template enforces)
- Security reports → mburaksu@gmail.com
- License key rotation: see `phase-6-handoff.md` § "Rotation"
- Database backups: hourly Postgres backup pipeline (per global
  CLAUDE.md monitoring stack)

## Project closure

Phase 12 closes the build phase. Production deployment, customer
onboarding, support runbooks, and pricing iteration are operator
work — see the handoff docs above.

🤖 Built with Claude Code over 30+ commits across Phases 4.5–12.
Phase 1–4 predate the multi-phase commit log; see git log for the
full history.
