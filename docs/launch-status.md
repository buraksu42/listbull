# Launch Status — listbull.org

> Generated 2026-05-02 by orchestrator. Updated as launch steps complete.
> See `docs/launch-checklist-phase-5.md` for the full runbook.

---

## ✅ Done

### Cloudflare DNS (zone `listbull.org`)

| Record | Type | Content | Proxy | TTL |
|---|---|---|---|---|
| `prod.listbull.org` | A | `46.224.144.255` (Hetzner prod) | OFF | Auto |
| `test.listbull.org` | A | `62.238.8.55` (Hetzner test) | OFF | Auto |

Verified with `dig @1.1.1.1 +short prod.listbull.org` / `test.listbull.org` → both resolve correctly. Cloudflare proxy is OFF on both (Let's Encrypt HTTP-01 needs direct origin).

**Apex `listbull.org` + `www.listbull.org`**: NOT configured. Page Rule for apex 308 redirect could not be set via API (token has DNS edit scope only, Page Rules API returned 9109 unauthorized). User can:
- Add the Page Rule manually in Cloudflare dashboard (1-min task), OR
- Build the apex static site per `launch-checklist-phase-5.md` § Step 11 and configure it then.

Until then, `listbull.org` returns NXDOMAIN — clean state, no broken proxy.

### Dokploy projects (shells only)

| Panel | Project | projectId | Default environment | environmentId |
|---|---|---|---|---|
| `test.bullshitapps.com` (test panel) | `listgram` | `KzL8C4rzUCXWJL9_Y1uPI` | production | `Q4CnYXk0ULx5IZHJdEI3B` |
| `prod.bullshitapps.com` (prod panel) | `listgram` | `AdLebd97nm1Y_uwG3yoZm` | production | `mqh3JC9TdvW7b3AZoimbD` |

Empty projects — no applications, no Postgres service, no env vars yet. Created so user can find the project in the panel and add resources without re-clicking "New Project".

---

## 🟡 Next — manual user action

The following steps need user input + visual verification + sensitive secret values, so they're best done in the Dokploy panel directly. Each is detailed in `docs/launch-checklist-phase-5.md`.

### Step 2a — Create the listgram applications

In **each Dokploy panel** (test panel for test deployment, prod panel for prod deployment):

1. Open the `listgram` project (already created — see IDs above).
2. **Add a new Application** (the main web app):
   - Source: GitHub → choose `buraksu42/listgram` (Dokploy must already have GitHub OAuth credential set up; if not, do that first).
   - Branch: `dev` for test panel; `main` for prod panel.
   - Build type: Dockerfile.
   - Dockerfile path: `./Dockerfile`.
   - Build context: `.` (repo root).
3. **Add a second Application** for the cron container:
   - Source: same GitHub repo + same branch as above.
   - Dockerfile path: `./Dockerfile.cron`.
   - No exposed port. (The cron Dockerfile's default CMD is the 60-second loop per `f843e89`.)
4. **Add a Postgres service** (under Databases → Postgres):
   - Image: `postgres:16-alpine`.
   - DB: `listgram`, user: `listgram`, password: random (Dokploy generates).
   - Volume: persistent.
5. Domain assignment for the main web app:
   - Test panel: `test.listbull.org`, port `3000`, HTTPS via Let's Encrypt.
   - Prod panel: `prod.listbull.org`, port `3000`, HTTPS via Let's Encrypt.
6. **Env vars + build args** — see Step 2b in the launch checklist for the full table (9 required).
   - Critical: every `NEXT_PUBLIC_*` value MUST be set as BOTH a runtime env var AND a build argument. Next 16 Turbopack inlines public env at build time.
7. Trigger the first build. Watch the logs for `Ready on 0.0.0.0:3000`.
8. Run migrations once: open the app container's shell in the Dokploy panel (or `docker exec listgram-app npm run db:migrate`).

### Step 3 — BotFather

Per `launch-checklist-phase-5.md` § Step 3 (newbot, setdescription, setabouttext, setcommands, setdomain, setjoingroups, setinline, setmenubutton, setWebhook curl).

Use **separate bots for test and prod**:
- Test: `@listgram_test_bot` (or any other free name)
- Prod: `@listgram_bot` (preferred — verify via `https://t.me/listgram_bot` first; fall back to `@listgram_app_bot` if taken)

### Step 4 — Smoke test

Per `launch-checklist-phase-5.md` § Step 4. Live test from a real Telegram client:
- `/api/health` returns `"status":"ok"`.
- Marketing landing renders (`prod.listbull.org` and `test.listbull.org`).
- `/start` to bot → DB row created → Mini App opens with Inbox visible.
- "süt al" message → item appears in Mini App within 5s.

### Step 5+ — Optional

- UptimeRobot keyword check on `/api/health`.
- Sentry instrumentation (operator opt-in).
- Umami analytics: `~/scripts/wire-umami.sh listgram` after first prod deploy.
- Demo GIF for README.
- GitHub repo public + topics.

---

## 🔵 Apex site (`listbull.org`) — separate deliverable

The apex domain serves the **open-source project info site**, NOT the listgram app. See `launch-checklist-phase-5.md` § Step 11 for hosting options (Cloudflare Pages / GitHub Pages / static container / Vercel) + minimum-viable Astro scaffold instructions. To be built in a follow-up session.

Until apex site exists, `listbull.org` returns DNS-not-found. Add a Page Rule manually if you want a placeholder redirect (Cloudflare dashboard → Rules → Page Rules → forward to `https://github.com/buraksu42/listgram` 308).

---

## 🟣 Tenant pattern (`<tenant>.listbull.org`)

Per `handoff/specs/architecture.md`, additional listgram instances can deploy at subdomains. Adding a new tenant:

1. Add an `A` record in Cloudflare for `<tenant>.listbull.org` pointing to a Hetzner host (shared with prod or dedicated).
2. Create a new Dokploy project (or add an environment to the existing `listgram` project).
3. Provision tenant-specific:
   - `DATABASE_URL` (separate Postgres DB or schema)
   - `TELEGRAM_BOT_TOKEN` (separate bot)
   - `BETTER_AUTH_SECRET`, `ENV_KEY`, `TELEGRAM_WEBHOOK_SECRET` — all rotated per tenant
   - `NEXT_PUBLIC_APP_URL=https://<tenant>.listbull.org`
4. Same Dockerfile build, separate domain.

`loyetta.listbull.org` is one such planned tenant (see `CLAUDE.md`).

---

## Rollback

To undo everything done so far:

```bash
# Cloudflare DNS records (use the IDs in this file's history if needed):
source ~/.ops-keys && ZONE=99e2f35bce2161233caa93af0e5715d8

# Delete prod + test A records
for id in 462b9d17c99a84696522293b813a3098 ab6d2041b641a5162949a44819a08901; do
  curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$id" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
done

# Dokploy projects (in each panel):
# Open Dokploy → listgram project → settings → delete (idempotent, won't hurt anything since they're empty shells).
```
