# Phase 5 Review — Launch prep

> Generated 2026-05-02 by orchestrator session (single-session per `handoff/specs/agents.md`).
> Phase 5 is single-session, pragmatic gate.

## Status: PASS — code-side complete, awaiting manual launch steps

The code-side scope of Phase 5 is committed. The launch itself is **manual user action** documented in `docs/launch-checklist-phase-5.md` (DNS + Dokploy env vars + BotFather setup + UptimeRobot + GitHub repo public). Until those steps run, listgram remains a local + CI build.

## Verification gate (pragmatic)

| Check | Status |
|-------|--------|
| `npm run lint` | ✅ clean |
| `npx tsc --noEmit` | ✅ clean |
| `SKIP_ENV_VALIDATION=1 npm run build` | ✅ clean (4 static + 26 dynamic + Proxy + new `/robots.txt` route) |
| `npm test` (Vitest 63/63) | ✅ clean |
| Standalone bundle emitted | ✅ `.next/standalone` (~64MB) + `.next/static` (~1.3MB) — Dockerfile copies these vs full node_modules |
| Final security grep | ✅ clean (see below) |
| gitleaks scan (5 commits, ~3MB) | ✅ no leaks |

## What shipped this phase

### Code

- **`src/app/robots.ts`** — env-aware robots.txt. Production allows `/` and `/snapshot/` (public marketing surfaces), disallows `/app/`, `/lists`, `/settings`, `/invites/`, `/api/`. Test/dev disallows everything.
- **`src/app/layout.tsx`** — `metadata.robots` set to `{ index: false, follow: false }` when `NEXT_PUBLIC_ENV !== 'production'` (belt-and-suspenders with `robots.ts`).
- **`next.config.ts`** — `output: "standalone"` enabled. Resolves Phase 4 P2 follow-up #1.
- **`Dockerfile`** — runner stage rewritten to copy `.next/standalone` + `.next/static` + `public` + `messages` (no full `node_modules`). Image footprint estimated ~150MB vs ~250MB. Resolves Phase 4 P2 follow-up #1.

### Documentation

- **`docs/launch-checklist-phase-5.md`** — comprehensive 10-step manual runbook covering pre-flight (bot username availability, server addresses), DNS (Cloudflare proxy OFF), Dokploy domain + env vars (full table) + Postgres + cron container, BotFather setup (newbot, setdescription, setabouttext, setcommands, setdomain, setjoingroups, setinline, setmenubutton, setWebhook curl call), live smoke checklist (8 steps), UptimeRobot keyword check, optional Sentry (Next 16 Turbopack `instrumentation-client.ts` copy-paste-ready) + Umami (`~/scripts/wire-umami.sh listgram`) + demo GIF, GitHub repo public + topics, dev → main merge with PR template, deferred Phase 4 staging gate activation (Lighthouse a11y, bundle scan, live Playwright E2E with `LISTGRAM_E2E_LIVE=1`, docker-compose wall-clock), repository hygiene + rollback plan + sign-off checklist.
- **`docs/review-phase-5.md`** — this file.

### NOT shipped (deferred to operator action per launch checklist)

- Sentry integration (operator opt-in — install `@sentry/nextjs` + drop `instrumentation-client.ts` per launch checklist § 6a). Avoids dead code + bundle bloat for self-hosters who don't use Sentry. The launch checklist contains the exact copy-paste snippet honoring the Next 16 Turbopack gotcha.
- Umami wiring (operator runs `~/scripts/wire-umami.sh listgram` post-deploy).
- Demo GIF (operator records via Telegram screen recorder).
- Repo public + topics (operator runs `gh repo edit` per launch checklist § 7).

## Final security pass — clean

- **No hardcoded secrets** in source: `grep -rE "sk-or-[a-zA-Z0-9]{8,}|sk-[a-zA-Z0-9]{20,}|bearer [a-zA-Z0-9]{20,}" src/` returns zero non-test/non-placeholder hits.
- **No `console.log` of secrets**: `grep -rE "console\.(log|warn|error|debug)" src/ | grep -iE "(api[_-]?key|token|initdata|secret|password|sk-or|sk-|openrouter)"` returns zero.
- **Webhook secret verified**: `src/app/api/telegram/webhook/route.ts:10` has `SECRET_HEADER = "x-telegram-bot-api-secret-token"`; line 14 verifies against env, returns 401 on mismatch.
- **HMAC constant-time compare**: 4 sites use `crypto.timingSafeEqual`:
  - `src/lib/auth/telegram-plugin.ts:109` — initData hash compare
  - `src/lib/auth/session.ts:92` — session cookie HMAC compare
  - `src/lib/server/lists/snapshot-token.ts:67,92` — D2 snapshot URL HMAC compare
- **initData 24h expiry**: `src/lib/auth/telegram-plugin.ts:36,78,80` — `MAX_AGE_MS = 24*60*60*1000` enforced.
- **No `.env*` committed** (other than `.env.example`): `git ls-files | grep -E '\.env'` returns only `.env.example`.
- **gitleaks scan**: 5 commits, ~3MB scanned, no leaks found.

## Phase 5 hand-off

Code-side is done. Hand off to **manual launch** per `docs/launch-checklist-phase-5.md`.

After successful launch (per the sign-off checklist at the end of the runbook), the project transitions from "shipping" to "operating" — bug fixes, feature requests, and Phase 6+ enhancements (long-polling for self-host behind NAT, pgvector RAG, etc.) follow normal git workflow with no orchestrator-driven phase machinery needed.

## Outstanding follow-ups (post-launch, not Phase 5 blockers)

- Phase 4 deferred staging gates (Lighthouse a11y, bundle scan, live Playwright E2E, docker-compose wall-clock validation). Activate via launch checklist § 9 once prod is live.
- One Phase 4 P2 left untouched: P2-2 / P2-6 (Backend↔Frontend type drift cleanup is mostly resolved; one or two Frontend files still have local types that mirror Backend exports — small, follow-up patch when next touched). Documented in `docs/review-phase-4.md` § 5.
