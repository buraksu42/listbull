# Backlog

> Future work tracked here. Not scoped into a phase yet — promote to
> an issue / PR when picked up. Anti-list rules in `project-state.md`
> § "What's NOT shipped" still apply.
>
> Chat-only architecture (Phase 17+). No Mini App. New entries that
> assume a web/Mini App surface should be rejected before they land
> here.

## Bot ↔ marketing parity

Every feature the bot ships should be reflected on the public marketing
site (`/features`, `/commands`) so prospective users can see the actual
surface before installing. New bot features land with a matching
marketing copy update in the same PR (or with a tracked follow-up).

## Outbound voice / TTS

Inbound voice is live (transcription via OpenRouter audio model,
group + DM). Outbound — TTS replies for long lists or accessibility
— is not. Gated by per-user setting (audio replies are intrusive).
Reuses the BYOK key path; falls back silently on free tier.

Surface area: 1 settings flag, 1 TTS client, ~2 webhook touch-ups.

## /ops dashboard — Tier 3 metrics

`/ops` shipped Tier 1+2 (window switcher, velocity, tags, retention,
items-per-chat, attachments) on PR #21. Remaining metric work:

- **Cohort retention matrix** — signup week × active week grid.
- **DOW seasonality** — `EXTRACT(DOW FROM ...)` on messages; only
  meaningful at the 90d window so combine with the existing switcher.
- **Group engagement** — `chat_members JOIN messages` to surface
  active-vs-lurker ratio per group chat. `chat_members` is currently
  not queried by /ops at all.
- **Chat lifespan + archive rate** — `archived_at - created_at`
  distribution, archive count over time window.
- **Reminders efficacy** — `fired_window / pending_window_ago` ratio.

## Recurring tasks — UX refinements

Clone-on-complete shipped (PR #20). Open follow-ups:

- **Custom RRULE editor** — the picker currently exposes daily /
  weekly / monthly / yearly presets. Power users want
  `FREQ=WEEKLY;BYDAY=MO,WE,FR` ("hafta içi her gün") and similar
  patterns via a UI rather than typing it natural-language.
- **Bulk skip / postpone next cycle** — "atla bu haftalık temizliği"
  should mark the current cycle done + skip the immediate next
  occurrence without changing the rule. Currently the user has to
  delete + recreate.
- **Recurrence end date** — `UNTIL=` clause via natural language
  ("her gün, gelecek ay sonuna kadar"). The cron path already
  handles `UNTIL=` exhaustion gracefully.

## Reminders — RRULE on absolute reminders

Items have task-level recurrence. Reminders also accept
`recurrence_rule` (the cron dispatcher already advances them via
`nextOccurrence`), but the bot UI doesn't currently let users create
a recurring reminder explicitly — natural language gets routed to
task recurrence instead. Surface area: prompt tweak + add_reminder
tool description + maybe a 🔁 toggle on the ⏰ flow.

## Self-host quality of life

- **First-boot wizard** — interactive script that walks through env
  vars (DATABASE_URL, ENV_KEY, TELEGRAM_BOT_TOKEN, …), creates the
  Telegram bot via BotFather instructions, runs migrations. Reduces
  the README install steps from ~15 to ~3.
- **Backup runbook** — currently the hosted prod uses Hetzner Object
  Storage + B2 dual-upload (managed elsewhere). A `pg_dump`-driven
  helper script + restore drill doc would help self-hosters.

## Promotion checklist (when picking up)

- Anti-list re-check: keep wedge tight — bot + Telegram only.
  Reject any entry that requires a web client or a Mini App.
- Schema diff + migration if touching DB.
- Marketing copy update + onboarding step if user-visible.
- Smoke test on `test.listbull.org` before merging to main.
