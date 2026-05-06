# Launch Checklist — Phase 5

> Generated 2026-05-02 by orchestrator session.
> Phase 5 is single-session orchestrator-driven; the heavy lift is **manual user action** (DNS, BotFather, Dokploy env vars). The code-side bits are committed in this phase's commit.

This document is the runbook for taking listbull from `dev` branch on the test server to a public production launch on `prod.listbull.org`.

---

## Pre-flight (5 min · do these BEFORE anything else)

### 1. Bot username availability check

`@listbull_bot` may already be taken on Telegram. Open `https://t.me/listbull_bot` in a browser:
- If it loads to "User not found" or a placeholder bot screen → username is **available**, proceed with `@listbull_bot`.
- If it loads to an active bot or shows "this username is taken" → fall back to `@listbull_app_bot` and update:
  - `.env.example` line `TELEGRAM_BOT_USERNAME`
  - `README.md` Quickstart section
  - Marketing landing's deeplink CTA (`src/app/(marketing)/page.tsx` already pulls from env, no edit needed)

### 2. Hetzner server addresses (sanity check)

- Prod: `46.224.144.255` (Hetzner CPX52, eu-central)
- Test: `62.238.8.55` (Hetzner CPX52, eu-central)

These are documented in `~/.claude/CLAUDE.md`. Confirm they're still your servers.

---

## Step 1 — DNS (Cloudflare)

`listbull.org` is the umbrella domain. Three-tier structure:

| Subdomain | Purpose | Hosted on |
|---|---|---|
| `listbull.org` (apex) | Open-source project info / install docs / GitHub link / "what is listbull" | **Separate static site** (deferred deliverable — see Step 11). NOT this listbull codebase. |
| `prod.listbull.org` | Production listbull app (Mini App + bot + DB) | This codebase, prod server `46.224.144.255` |
| `test.listbull.org` | Test/staging listbull app | This codebase, test server `62.238.8.55` |
| `<tenant>.listbull.org` (e.g. `loyetta`) | Additional tenant deployments (same code, separate DB + bot) | This codebase, deployed per-tenant via Dokploy |

Cloudflare proxy MUST be **OFF** for app subdomains (Let's Encrypt HTTP-01 challenge requires direct origin). The apex `listbull.org` static site can be Cloudflare-proxied since it has no webhook.

| Type | Name | Content | Proxy | TTL | Notes |
|---|---|---|---|---|---|
| A | `prod` | `46.224.144.255` | DNS only | Auto | Production app server (Hetzner) |
| A | `test` | `62.238.8.55` | DNS only | Auto | Test app server (Hetzner) |
| A | `@` (apex) | (apex static site host) | Proxy ON OK | Auto | Project info site — see Step 11 for hosting options (GitHub Pages, Cloudflare Pages, Vercel, Hetzner static container) |
| CNAME (optional) | `www` | `listbull.org` | Proxy follows apex | Auto | Convenience redirect — many users type `www.listbull.org` |

Per-tenant subdomain pattern: add an `A` record `<tenant>` → either prod server (sharing infrastructure) or a dedicated tenant server. Each tenant deployment uses its own `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, and `TELEGRAM_BOT_TOKEN`.

Verify with `dig`:
```bash
dig +short listbull.org         # apex — depends on Step 11 host
dig +short prod.listbull.org    # expect 46.224.144.255
dig +short test.listbull.org    # expect 62.238.8.55
```

Wait for propagation (usually <5 min on Cloudflare).

---

## Step 2 — Dokploy app setup

Two Dokploy applications: one watching `dev` branch (test server, deploys to `test.listbull.org`), one watching `main` (prod server, `prod.listbull.org`).

For each app:

### 2a. Domain assignment

Dokploy panel → app → Domains:
- Test app → `test.listbull.org`, port `3000`, HTTPS via Let's Encrypt (`letsencrypt-dns` resolver).
- Prod app → `prod.listbull.org`, port `3000`, HTTPS via Let's Encrypt.

### 2b. Environment variables

Set the following env vars in Dokploy panel → app → Environment. **Required minimum** for boot:

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://listbull:<pw>@<db-host>:5432/listbull` | Internal Docker network host name. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | ≥32 chars. |
| `BETTER_AUTH_URL` | `https://prod.listbull.org` (prod) / `https://test.listbull.org` (test) | Match the domain. |
| `ENV_KEY` | `openssl rand -base64 32` | AES-256-GCM key for BYOK encryption. **Rotation = all stored keys unreadable; document re-prompt procedure.** |
| `TELEGRAM_BOT_TOKEN` | From BotFather (Step 3) | Different bots for test vs prod recommended. |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 32` | Set on `setWebhook` call AND verified on every incoming request. |
| `TELEGRAM_BOT_USERNAME` | `listbull_bot` (or fallback) | Without `@`. |
| `NEXT_PUBLIC_APP_URL` | `https://prod.listbull.org` (prod) / `https://test.listbull.org` (test) | Used in deeplinks + invite URLs. |
| `NEXT_PUBLIC_ENV` | `production` (prod) / `test` (test) | Test gates `<meta noindex>` + robots disallow. |

**Optional** (operator opt-in):
| Var | Value | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | `sk-or-…` | Operator-level fallback when user has no BYOK key set. Leave blank to require BYOK from every user. |
| `LISTBULL_PER_USER_HOURLY_MSG_LIMIT` | `0` (default) | Per-user runaway cost cap. |
| `LISTBULL_HEARTBEAT_URL` | Better Stack URL | Cron liveness ping. **Liveness, NOT delivery health** — fires on tick complete, regardless of per-row send failures. |
| `HETZNER_OBJECT_STORAGE_*` (5 vars) | See `.env.example` | F1 export uploads. Without these, F1 falls back to base64 data URLs (works for small installs). |
| `SNAPSHOT_SIGNING_KEY` | `openssl rand -base64 48` | D2 snapshot URL HMAC. Falls back to `BETTER_AUTH_SECRET` when unset. |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry project DSN | Triggers Sentry init at runtime (see Step 6 if you want this). |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | UUID from `analytics.bullshitapps.com` | Set via `~/scripts/wire-umami.sh listbull` post-deploy. |

**Build args** — for any `NEXT_PUBLIC_*` var, ALSO set it as a build argument in Dokploy (Build Settings → Build Args). Next 16 Turbopack inlines public env at build time, not runtime — without the build arg, the value is absent from the client bundle even if the runtime env is set.

### 2c. Postgres service

In Dokploy, create a Postgres service (or reuse an existing shared instance — global CLAUDE.md mentions `umami-db` lives on the same server, your call):
- Image: `postgres:16-alpine`
- Volume: persistent, mounted at `/var/lib/postgresql/data`
- DB: `listbull`, user: `listbull`, password: random
- Healthcheck: `pg_isready -U listbull`

Note: the `docker-compose.yml` in this repo brings up a self-contained Postgres for self-hosters. Dokploy operators can either use that compose service OR a separate Dokploy-managed Postgres — but NOT both at once.

### 2d. Cron container (Phase 3 reminder dispatcher)

Either:
- Use the `Dockerfile.cron` shipped in the repo (Dokploy second app pointing at the same repo, build with `Dockerfile.cron`, no exposed port), OR
- Run the cron tick via a Dokploy scheduled job hitting an internal endpoint.

The compose file already wires this for self-hosters.

---

## Step 3 — BotFather setup

Open `@BotFather` on Telegram. **Do steps for the prod bot AND a separate test bot** if you want strict environment separation.

### 3a. Create bot

```
/newbot
listbull
listbull_bot          (or listbull_app_bot if taken)
```

Save the bot token → goes into `TELEGRAM_BOT_TOKEN` env var. **Different tokens for test and prod.**

### 3b. Description, about text, profile photo

```
/setdescription
@listbull_bot
A Telegram-native AI list assistant with persistent shared list memory. Capture todos in chat, manage in a Mini App. BYOK + open source.
```

```
/setabouttext
@listbull_bot
Telegram-native AI list assistant. Self-host: github.com/buraksu42/listbull
```

```
/setuserpic
@listbull_bot
[upload handoff/brand/png/listbull-app-icon-1024.png — pre-rendered raster ready for BotFather]
```

### 3c. Commands list

```
/setcommands
@listbull_bot
start - Set up your account and create your Inbox
help - Show available commands and tips
lists - Show all your lists
share - Share a list with someone
snapshot - Generate a public snapshot link for a list
reset - Clear your conversation history with the bot
```

### 3d. Mini App configuration

```
/setdomain
@listbull_bot
prod.listbull.org   (or test.listbull.org for the test bot)
```

```
/setjoingroups
@listbull_bot
Disable
```

```
/setinline
@listbull_bot
Enable
Search items…
```

```
/setmenubutton
@listbull_bot
Web App
https://prod.listbull.org/app
listbull        (button label)
```

### 3e. Webhook (one-time `setWebhook` call)

Run on your laptop:

```bash
TOKEN="<your bot token>"
SECRET="<TELEGRAM_WEBHOOK_SECRET from Dokploy env>"
URL="https://prod.listbull.org/api/telegram/webhook"  # or test.listbull.org for test bot

curl -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d "{
    \"url\": \"${URL}\",
    \"secret_token\": \"${SECRET}\",
    \"drop_pending_updates\": true,
    \"allowed_updates\": [\"message\",\"inline_query\",\"callback_query\"]
  }"
```

Verify:

```bash
curl "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
```

Look for `"url": "<your url>"`, `"has_custom_certificate": false`, `"pending_update_count": 0`, `"last_error_message": ""`.

---

## Step 4 — Smoke test (live, do this now)

After DNS + Dokploy + BotFather are set:

1. **Health endpoint**:
   ```bash
   curl https://prod.listbull.org/api/health
   # Expect: {"status":"ok","db":"ok","ts":<ms>}
   ```

2. **Marketing landing**: open `https://prod.listbull.org` in a browser. See hero + features + footer (light theme, anti-list strict).

3. **Bot `/start`**: open Telegram, search `@listbull_bot`, send `/start`. Expect localized welcome + "Inbox created" copy.

4. **DB verification** (optional, via Dokploy Postgres console):
   ```sql
   SELECT id, telegram_id, telegram_username, created_at FROM users ORDER BY created_at DESC LIMIT 1;
   SELECT id, name, is_inbox FROM lists WHERE owner_id = '<the user id>';
   ```
   Should see one user + one inbox list.

5. **Mini App**: in Telegram, tap the menu button → Mini App opens at `/app`. After auth boot, redirects to `/lists`. Inbox visible.

6. **Send "süt al"** to bot → bot replies, item appears in `/lists/<inbox-id>` Mini App view within 5s polling.

7. **`/lists` slash command**: deeplink list shows up.

If any step fails, check Dokploy app logs first — most likely cause is a missing env var.

---

## Step 5 — UptimeRobot monitor

Per global CLAUDE.md monitoring standard:
- Type: **HTTPS Keyword**
- URL: `https://prod.listbull.org/api/health`
- Keyword: `"status":"ok"` (with quotes)
- Interval: **5 minutes**
- Alert contacts: email
- HTTP auth: none (`/api/health` is auth-exempt by spec)

Wait 5-10 min, confirm green. (Test server uses Tailscale IP `100.71.130.74` per CLAUDE.md; for the test environment, you can either skip the UptimeRobot monitor or run it via the Tailscale relay.)

---

## Step 6 — Optional integrations (operator opt-in)

### 6a. Sentry (Next 16 Turbopack — IMPORTANT)

Per global CLAUDE.md "Sentry / Next 16 Turbopack" gotcha: `sentry.client.config.ts` is silently dropped by Turbopack. Use `instrumentation-client.ts` instead.

If you want Sentry:

1. `npm install @sentry/nextjs --save`
2. Create `instrumentation-client.ts` at repo root:

   ```ts
   import * as Sentry from "@sentry/nextjs";

   if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
     Sentry.init({
       dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
       environment: process.env.NEXT_PUBLIC_ENV ?? "development",
       tracesSampleRate: 0.1,
       integrations: [Sentry.replayIntegration()],
       replaysSessionSampleRate: 0.0,
       replaysOnErrorSampleRate: 1.0,
     });
   }
   ```

3. Server-side: create `instrumentation.ts` at repo root with `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN })` inside `register()`.
4. Set `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` in Dokploy (DSN as both runtime env AND build arg).
5. Deploy.
6. **Verify**: deploy a smoke commit → in browser console run `Sentry.captureMessage("deploy-smoke")` → check Sentry dashboard receives the event. Bundle scan alone is NOT sufficient (Turbopack inlines via preload + RSC payload, not chunks).

### 6b. Umami analytics (managed instance)

Per global CLAUDE.md, single shared Umami at `analytics.bullshitapps.com`. Frontend already renders `<UmamiAnalytics />` if `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is set in build args.

Run on your laptop after first prod deploy:

```bash
~/scripts/wire-umami.sh listbull
```

This idempotently:
1. Creates an Umami website (or reuses if already there)
2. Updates Dokploy `buildArgs` with `NEXT_PUBLIC_UMAMI_WEBSITE_ID`
3. Triggers a redeploy (one extra Dokploy round-trip)

**Verify** post-deploy:
```bash
curl -s https://prod.listbull.org/ | grep analytics.bullshitapps.com
```
HTML preload + RSC payload should match. Then open the Umami dashboard — events show within 1 min.

### 6c. Demo GIF for README

Phase 4 README has `![demo](docs/demo.gif)` placeholder. To replace:

1. Open Telegram on a phone with a screen recorder.
2. Record a 10-15s flow: send "süt al" to bot → tap Mini App → see Inbox → tap item → check it off.
3. Convert to GIF (≤2MB, 480px wide). Tools: `ffmpeg -i input.mp4 -vf "fps=10,scale=480:-1" -loop 0 docs/demo.gif`.
4. Commit the GIF to the repo (Git LFS not needed at this size).
5. Push to dev → after merge to main, README on GitHub renders the demo.

---

## Step 7 — GitHub repo public + topics

```bash
# Repo is private by default per global CLAUDE.md; flip when launch-ready:
gh repo edit buraksu42/listbull --visibility public

# Add discoverability topics:
gh repo edit buraksu42/listbull \
  --add-topic telegram \
  --add-topic telegram-bot \
  --add-topic telegram-mini-app \
  --add-topic ai \
  --add-topic todo-list \
  --add-topic nextjs \
  --add-topic typescript \
  --add-topic open-source \
  --add-topic self-hosted \
  --add-topic byok
```

Verify on `https://github.com/buraksu42/listbull` — see the README, LICENSE link in sidebar, topics under the description.

---

## Step 8 — Merge `dev` → `main` (production deploy)

```bash
# Open PR (or self-merge):
gh pr create --base main --head dev --title "Phase 5: launch" \
  --body "$(cat <<'EOF'
Phase 5 launch prep complete. Merging Phases 1-5 from dev to main.

- Phases 1-4 fully shipped on dev branch (commits c33e51f → d435b0e).
- Phase 5: robots.ts + noindex on non-prod + next.config standalone +
  Dockerfile size optimization + launch checklist runbook.
- Verification: lint + tsc + build + Vitest 63/63 all clean.
- Live smoke deferred to post-merge (DNS + Dokploy env + BotFather setup
  per docs/launch-checklist-phase-5.md).
EOF
)"

# Self-merge (per global CLAUDE.md OK for solo workflow):
gh pr merge --squash --auto
```

After merge, Dokploy auto-deploys to prod server. Watch logs:

```bash
# From your laptop with Dokploy CLI / SSH:
ssh prod 'docker logs -f $(docker ps --filter name=listbull-app --format "{{.ID}}")'
```

Wait for `Ready on 0.0.0.0:3000`.

Then re-run the smoke checklist (Step 4) against `https://prod.listbull.org`.

---

## Step 9 — Activate deferred Phase 4 staging gates

Phase 4 review (`docs/review-phase-4.md`) flagged 4 gates as deferred to Phase 5 staging:

### 9a. Lighthouse a11y on `/lists`

Live env required (auth-gated route).

```bash
# From your laptop, with the dev server bot running:
npx --yes lighthouse https://prod.listbull.org/lists \
  --only-categories=accessibility \
  --output=json --output-path=./lighthouse-a11y.json \
  --chrome-flags="--headless --no-sandbox"

# Manual: copy a session cookie from a real Telegram Mini App session
# into Lighthouse via --extra-headers. Or use Playwright's a11y-axe
# integration in the e2e harness for repeatable runs.
```

Target: ≥95.

### 9b. Bundle scan (Sentry + Umami inlining sanity)

```bash
# Sentry (only if you wired Step 6a):
curl -s https://prod.listbull.org/_next/static/chunks/*.js | \
  grep -E 'ingest\.(de\.)?sentry\.io|@sentry|sentryDsn' && echo "Sentry inlined ✓"

# Umami:
curl -s https://prod.listbull.org/ | grep analytics.bullshitapps.com && \
  echo "Umami HTML scan ✓"
```

Expected: both match if wired.

### 9c. Live Playwright E2E

Phase 4 ships 4 E2E specs gated by `LISTBULL_E2E_LIVE=1` env. To activate:

```bash
LISTBULL_E2E_LIVE=1 \
  TEST_BOT_TOKEN="<your test bot token>" \
  TEST_DATABASE_URL="postgres://...test_db..." \
  npm run e2e
```

Adapt to whatever shape `tests/e2e/*.spec.ts` expects.

### 9d. `docker-compose up` clean-room wall-clock

On a fresh Hetzner node (or a clean local VM):

```bash
git clone https://github.com/buraksu42/listbull.git
cd listbull
cp .env.example .env
# Fill .env with real values (Step 2b above)
time docker compose up -d
docker compose logs -f app   # wait for "Ready"
```

README claim: <15 min. Wall-clock check: was it <15 min from `git clone` to `/start` working in Telegram?

---

## Step 10 — Repository hygiene (post-launch)

- Add a CHANGELOG.md with Phase 1-5 highlights (one-liner per phase, link to commits).
- Add a Discussions tab on GitHub for self-host questions (keep Issues for bugs).
- Pin two issues: "Self-host setup help" and "Feature requests roadmap".
- Run `gh repo view --json licenseInfo` — confirm GitHub recognized the LICENSE file (MIT badge appears).
- Submit listbull to:
  - https://github.com/awesome-selfhosted/awesome-selfhosted (PR with one-line entry)
  - r/selfhosted (post once stable for 2 weeks)
  - HN Show / Lobsters (only when 0 known critical bugs)

---

## Step 11 — Apex site (`listbull.org`) — separate deliverable

**Not built in this codebase.** The apex `listbull.org` is a project-info / open-source landing site explaining "what is listbull, how do I install it, where's the GitHub". It's intentionally decoupled from the listbull app:

- **Concern separation**: the app deployments (`prod.listbull.org`, `<tenant>.listbull.org`) host the live product. The apex hosts the project narrative.
- **Independent deploy cadence**: docs change without redeploying the app, and vice versa.
- **Cheaper hosting**: a static site costs nothing on Cloudflare Pages / GitHub Pages.

### Recommended structure for the apex site

A small static site with the following pages/sections:

- `/` — Hero ("listbull — Telegram-native AI list assistant"), short pitch, "Try the live demo" CTA → `prod.listbull.org`, "View on GitHub" CTA.
- `/install` — Self-host quickstart (mirror README's Quickstart). Docker Compose, env var template, BotFather setup, DNS, deploy targets (Dokploy, Fly, bare VPS).
- `/architecture` — High-level diagram (Bot ↔ Webhook ↔ App ↔ DB ↔ OpenRouter), link to `handoff/specs/architecture.md` in the listbull repo for full spec.
- `/contributing` — Mirror `CONTRIBUTING.md`. Link to issues + Discussions.
- `/changelog` — Released versions (Phases 1-5 → v0.1, future releases).
- `/tenants` — (optional) A growing list of `<tenant>.listbull.org` instances, who runs them, their purpose. Validates the tenant pattern publicly.

### Hosting options (pick one)

1. **Cloudflare Pages** (recommended): connect a GitHub repo `buraksu42/listbull-org`, build via Astro / Eleventy / Next.js static export. Custom domain → `listbull.org`. Free tier covers this scale.
2. **GitHub Pages**: same repo, push to `gh-pages` branch. Add `CNAME` file containing `listbull.org`. Free, slightly less flexible.
3. **A second Dokploy app**: `Dockerfile` with Caddy or nginx serving static files. Same Hetzner box. More control, more ops.
4. **Vercel**: simplest if you already have a Vercel account. Connect repo, custom domain. Free tier.

### Building the apex site (deferred — not Phase 5 code-side scope)

To be done in a follow-up session. The minimum viable apex site can ship in <2 hours with Astro:

```bash
mkdir ~/projects/listbull-org && cd ~/projects/listbull-org
npm create astro@latest .
# Pick "minimal" template, TypeScript "strict", no add-ons.
# Add a couple of MDX pages mirroring the README sections above.
# Push to github.com/buraksu42/listbull-org.
# Connect Cloudflare Pages → custom domain → listbull.org.
```

Until the apex site exists:
- Park `listbull.org` on a one-page placeholder ("Coming soon — the listbull project. Live demo: prod.listbull.org. Source: github.com/buraksu42/listbull"), OR
- 308 redirect `listbull.org` → `github.com/buraksu42/listbull`. Cloudflare Page Rule.

---

## Rollback / disaster recovery

If prod deploy goes sideways:

```bash
# Re-deploy a known-good commit:
ssh prod 'cd /etc/dokploy/<app-path> && git checkout <last-good-sha> && docker compose up -d --build'
```

If `ENV_KEY` was rotated and existing BYOK keys are unreadable:
- Roll back `ENV_KEY` to the old value (Dokploy redeploy with old env).
- Failing that, document: tell users to re-enter their OpenRouter key. Their existing items + lists are intact; only the API key needs re-set.

If the bot webhook is hit by spoofed traffic (`X-Telegram-Bot-Api-Secret-Token` mismatch alarms):
- Generate a new `TELEGRAM_WEBHOOK_SECRET`.
- Redeploy app with new env.
- Re-run the `setWebhook` call (Step 3e) with the new secret.
- Old secret traffic returns 401 (correct).

---

## Sign-off checklist

Before announcing the launch:

- [ ] DNS resolves both `prod.listbull.org` and `test.listbull.org`.
- [ ] HTTPS cert valid + auto-renewing on both.
- [ ] `/api/health` returns 200 + `"status":"ok"` on both.
- [ ] Marketing landing renders cleanly (light only, anti-list, OG image valid).
- [ ] Bot `/start` works end-to-end (DB row + Mini App opens + Inbox visible).
- [ ] BotFather webhook info shows zero pending updates + zero recent errors.
- [ ] UptimeRobot monitor green for ≥1h.
- [ ] Sentry receives a smoke event (if wired in Step 6a).
- [ ] Umami dashboard shows the marketing landing visit (if wired in Step 6b).
- [ ] Hourly Postgres backup (per global CLAUDE.md monitoring standard) caught the new DB on the next tick — check Healthchecks.io dashboard.
- [ ] Cert expiry monitor picked up the new domain on next daily scan.
- [ ] GitHub repo is public, README + LICENSE rendered, topics set.
- [ ] You can demo the full happy path from a fresh phone in <60 seconds.

🚀 Ship it.
