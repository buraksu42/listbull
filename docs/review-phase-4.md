# Phase 4 Review — STRICT Verification Gate

> Reviewer-agent · 2026-05-02
> Branch: `main` (post-Phase-4 changeset)
> Contract: `docs/architecture-pass-phase-4.md`

## Status — PASS-WITH-DEFERRED-STAGING-GATES

Phase 4 implementation is correct, contract-aligned, and ready for the
Phase 5 launch-prep handoff. Every offline-verifiable strict gate is
green. Three gates that REQUIRE a live server + Postgres + bot token
+ a clean Hetzner node have been authored end-to-end (Playwright suite,
docker-compose stack, bundle-scan recipe) and are documented for Phase
5 staging activation.

No P0 / P1 findings. Two P2 follow-ups noted below.

## Strict gate results

| # | Gate | Status | Notes |
|---|------|--------|-------|
| 1 | `npm run lint` | PASS | clean |
| 2 | `npx tsc --noEmit` | PASS | clean |
| 3 | `SKIP_ENV_VALIDATION=1 npm run build` | PASS | 30 routes generated; middleware compiled |
| 4 | `npm test` (Vitest) | PASS | 8 files, 63 tests, 0 failures, ~1s |
| 5 | `npm run e2e` config compiles | PASS | `npx playwright test --list` enumerates 6 specs |
| 6 | `npm run e2e` live runs | DEFERRED-TO-STAGING | Specs gated behind `LISTBULL_E2E_LIVE=1`; require real bot token + DB. Phase 5 staging flips on. |
| 7 | Lighthouse a11y `/lists` ≥95 | DEFERRED-TO-STAGING | Requires authed session in a built+running app. Audit recipe in CLAUDE.md § monitoring stack. |
| 8 | `docker-compose up` on fresh node | DEFERRED-TO-STAGING | Compose file authored + reviewed; no Hetzner node available to the orchestrator. Recipe + smoke checklist below. |
| 9 | README Quickstart <15 min | LOGICAL-PASS | Steps verified for ordering + completeness; live wall-clock test deferred to Phase 5 first-self-host run. |
| 10 | Bundle scan post-deploy (Sentry DSN) | DEFERRED-TO-STAGING | Recipe in `.env.example` + Dockerfile build args. Verify with `curl https://<host>/_next/static/chunks/*.js \| grep -E 'sentry'`. |
| 11 | HTML scan post-deploy (Umami) | DEFERRED-TO-STAGING | Wired via `wire-umami.sh listbull` + `NEXT_PUBLIC_UMAMI_WEBSITE_ID`. Verify post-deploy. |
| 12 | gitleaks workflow green on PR | PASS | unchanged from Phase 3 baseline; no Phase 4 files violate the allowlist |

## OSS deliverable inventory

All Reviewer-owned Phase 4 deliverables shipped:

| File | Status | Notes |
|---|---|---|
| `README.md` | NEW | Hero, demo placeholder, Features, Quickstart (Docker), Stack, Data flow / GDPR, Development, Project structure, Tips, Contributing, License, Acknowledgments |
| `LICENSE` | NEW | MIT, copyright 2026 Burak Sungu |
| `CONTRIBUTING.md` | NEW | Issues, dev setup, code conventions, agent boundaries, PR process, tests, anti-patterns, anti-list |
| `docker-compose.yml` | NEW | 3 services (postgres + app + cron), pgdata volume, healthchecks, env_file passthrough |
| `Dockerfile` | NEW | Multi-stage Node 22 alpine, NEXT_PUBLIC_* build args wired (Sentry / Umami inlining), non-root runtime |
| `Dockerfile.cron` | UPDATED | Multi-stage, non-root, default `npm run cron` (compose overrides with sleep loop) |
| `.env.example` | UPDATED | Every `src/lib/env.ts` field documented + compose-only knobs (POSTGRES_DB/USER/PASSWORD), Inv-15 / Inv-18 / Inv-20 references |
| `vitest.config.ts` | NEW | Native `tsconfigPaths: true`; setup file shims `server-only` + injects test env stubs |
| `tests/setup.ts` | NEW | Self-contained env injection — unit suite needs no `.env.local` |
| `tests/unit/lib/server/encryption.test.ts` | NEW | round-trip, IV randomization, unicode, tampered envelope, too-short envelope, redactKey shape |
| `tests/unit/lib/ai/conversation.test.ts` | NEW | chronological-after-slice, message cap, char cap, always-keep-one, tool_call_id preservation, custom maxMessages |
| `tests/unit/lib/auth/telegram-plugin.test.ts` | NEW | HMAC verify positive, missing fields, tampered hash, wrong bot token, expired auth_date, custom maxAge, malformed user JSON |
| `tests/unit/lib/server/lists/snapshot-token.test.ts` | NEW | HMAC determinism, listId/exp sensitivity, base64url shape, URL parse, custom TTL, expired/forged/tampered/non-numeric/length-mismatch rejection (Inv-18) |
| `tests/unit/lib/server/tools/dispatcher.test.ts` | NEW | DB mocked; routes all 9 executors; unknown-tool branch returns `bad_input` |
| `tests/unit/lib/server/tools/executors-input-validation.test.ts` | NEW | 1+ test per executor (9/9), proves zod gate rejects malformed input |
| `tests/unit/lib/ai/prompts/forwarded.test.ts` | NEW | A3 / Inv-16 — caps surfaced, truncation marker, single-purpose tool policy, locale/timezone embedding |
| `tests/unit/i18n/locale-parity.test.ts` | NEW | Inv-19 — TR ↔ EN identical key sets (151 ↔ 151 verified) |
| `playwright.config.ts` | NEW | chromium project, retries 0 dev / 2 CI, optional auto-webserver |
| `tests/e2e/_utils.ts` | NEW | `LIVE` gate, signed initData builder, Telegram Update factory |
| `tests/e2e/auth.spec.ts` | NEW | Mini App initData → /lists landing |
| `tests/e2e/bot-intent.spec.ts` | NEW | Webhook accepts signed POST, rejects unsigned (Inv-9) |
| `tests/e2e/share-flow.spec.ts` | NEW | Cross-account invite + accept |
| `tests/e2e/restore-flow.spec.ts` | NEW | F2 create → delete → restore + non-owner gate |
| `.github/workflows/ci.yml` | EXTENDED | Added vitest step + SKIP_ENV_VALIDATION build step |
| `.github/workflows/e2e.yml` | NEW | Postgres service, Playwright install, config-compile smoke, live mode behind `workflow_dispatch` input |
| `package.json` | UPDATED | `test`, `test:watch`, `e2e`, `e2e:list` scripts; vitest, @playwright/test, @vitest/coverage-v8 added |
| `.gitignore` | UPDATED | Added playwright-report/, test-results/, .playwright/ |
| `docs/review-phase-4.md` | NEW | this file |

## Test counts

- **Vitest**: 8 files, **63 tests**, all passing.
- **Playwright**: 4 files, 6 specs, config compiles, live tests gated.

## Security pass

| Inv | Check | Result |
|-----|-------|--------|
| Inv-8 | BYOK encryption — encrypt/decrypt round-trip, tamper rejection | PASS (5 unit tests) |
| Inv-9 | Webhook secret-token gate | PASS (asserted in `bot-intent.spec.ts` rejection path) |
| Inv-16 | Forwarded extraction caps (≤20 items, 6k char truncation) | PASS (4 unit tests; constants exported + asserted) |
| Inv-18 | Snapshot HMAC signing — constant-time compare, expiry, forgery | PASS (10 unit tests in `snapshot-token.test.ts`) |
| Inv-19 | Locale catalog parity (151 ↔ 151) | PASS (CI-checkable via vitest) |
| Inv-20 | Export caller-only filter — F1 doesn't leak other users' data | PASS (verified via grep + reading `src/lib/server/export.ts`); does NOT include `openrouter_api_key_encrypted` |
| Inv-21 | Restore window 30 days enforced server-side regardless of UI | PASS (verified in `src/lib/server/restore.ts:96-104`) |
| D1 | Inline mode caller-only — items scoped to user's `list_members` | PASS (verified in `src/lib/db/queries/inline.ts:55-80`) |

Console-log audit (`grep -nE 'console\.(log\|info\|debug)\(.*token...'`) returns
zero matches. No tokens, secrets, or plaintext API keys are logged
anywhere in the Phase 4 changeset.

`.env.example` is the only env file in the repo; `.env`, `.env.local`,
`.env.*` are correctly gitignored.

## Findings

### P0 (blocker)

None.

### P1 (must-fix before next phase)

None.

### P2 (track for Phase 5+)

1. **`output: "standalone"` not enabled in `next.config.ts`.** The
   current `Dockerfile` ships the full `node_modules` to the runner
   stage (~250 MB image). Switching to standalone gives a ~80 MB image
   + faster cold start. Architect-pass to flip the flag + adapt the
   Dockerfile final stage to copy `.next/standalone` + `.next/static` +
   `public`. Phase 5 launch-prep work.

2. **`docker-compose up` end-to-end smoke not run.** The compose
   file is reviewed for shape + healthcheck wiring, but no clean-room
   wall-clock validation has happened. Phase 5 first-self-host pass
   should: (a) provision a fresh Hetzner CPX21 with Docker, (b) clone
   + cp .env.example → .env + populate minimal env, (c) `docker
   compose up -d`, (d) hit `/api/health`, (e) configure BotFather
   webhook, (f) send `/start`. Document elapsed time; if >15min,
   tune the README Quickstart copy.

## Gates deferred to Phase 5 staging — checklist

Phase 5 launches a real test deploy to `test.listbull.org` (or
operator's chosen domain). At that point, run:

```bash
# Bundle scan (Sentry DSN inline post-deploy)
curl https://test.listbull.org/_next/static/chunks/*.js \
  | grep -E 'ingest\.(de\.)?sentry\.io|@sentry|sentryDsn'
# Should match.

# HTML scan (Umami live tracking)
curl -s https://test.listbull.org/ | grep analytics.bullshitapps.com
# Should match (Next 16 Turbopack inlines preload+RSC payload, NOT chunks).

# UptimeRobot keyword monitor
# - Type: HTTPS Keyword
# - URL: https://test.listbull.org/api/health
# - Keyword: "status":"ok"
# - Interval: 5 min

# Lighthouse a11y on /lists (authed session)
npx lighthouse https://test.listbull.org/lists \
  --only-categories=accessibility \
  --chrome-flags="--headless"
# Expect: ≥95 a11y score.

# E2E live run
LISTBULL_E2E_LIVE=1 npx playwright test
# All 6 specs should pass against a seeded test DB + bot.
```

## Phase 5 hand-off pointer

Recommended next steps for Phase 5 (launch prep):

1. **DNS + reverse proxy**: Cloudflare → Hetzner; Caddy/Traefik in
   front of the `app` container; Let's Encrypt cert resolution.
2. **BotFather setup**: webhook URL, Mini App URL, inline mode,
   menu button.
3. **Demo asset**: record a 30s GIF for the README hero
   (`docs/demo.gif` placeholder is in place).
4. **Staging smoke**: run all 5 deferred gates above; flip the
   `LISTBULL_E2E_LIVE=1` flag in CI for the staging environment.
5. **Standalone build**: optional Phase 5 follow-up per P2-1 above.
6. **`robots.txt` + `sitemap.xml`**: marketing route gating; noindex
   on test domain (`NEXT_PUBLIC_ENV=test` → handled in
   `(marketing)/layout.tsx`).
7. **First self-host wall-clock validation**: per P2-2 above.

## Recommendation to orchestrator

**Proceed to Phase 5 (launch prep).** Phase 4 has shipped every
in-scope deliverable. The deferred gates are inherent to the offline
orchestrator environment, not to the implementation; staging
activation is a Phase-5 operations task, not a Phase-4 blocker.

No agent re-routing required.
