# Phase 5 — Operator Handoff (Launch Checklist)

> Generated 2026-05-06.
> Phase 5 closes here from a code perspective. Production launch
> requires operator-side work this document spells out.
>
> Reference: `docs/architecture-pass-phase-4.5.md` § "Phase 5
> (revised)" and `docs/review-phase-4.5.md` § "Phase 5 entry checklist".

## Status

| Phase 5 work | Code status | Operator action needed |
|---|---|---|
| Mini App billing UI (upgrade button, past-due banner, success page) | ✅ Shipped (commit `49b01b6`) | — |
| Marketing landing reframe (blur audience) | ✅ Shipped (commit `afcd3f5`) | Review copy + adjust pricing |
| Iyzico SDK + checkout + webhook | ✅ Shipped (commit `0ff8db6`) | Configure Iyzico account + plans |
| Multi-bot wiring (per-bot webhook, registration, UI, bot-aware reminders) | ✅ Shipped (commit `be34907`) | None for default-bot users |
| BILLING_ENFORCE flip | ⏸ Operator-blocked | Set env var on Dokploy |
| Stripe production keys | ⏸ Operator-blocked | Stripe dashboard |
| Iyzico production keys + plan setup | ⏸ Operator-blocked | Iyzico dashboard |
| Upstash KV idempotency swap | ⏸ Operator-blocked | Upstash account |
| BotFather production bot | ⏸ Operator-blocked | @BotFather chat |
| Repo public on GitHub | ⏸ Operator-blocked | GH repo settings |
| Live customer signup verification | ⏸ Operator-blocked | Real card test |

## Operator launch sequence

Run these in order. Each step has a verification block.

### Step 1 — Stripe production setup

1. Stripe dashboard → create products:
   - **Team** — $5/mo subscription
   - **Workspace** — $15/mo subscription
2. Note each product's Price ID (`price_xxx`).
3. Stripe → Webhooks → Add endpoint:
   - URL: `https://prod.listbull.org/api/webhooks/stripe`
   - Events:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
4. Note the webhook signing secret (`whsec_xxx`).
5. Dokploy prod env:
   ```
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   STRIPE_PRICE_TEAM=price_xxx
   STRIPE_PRICE_WORKSPACE=price_xxx
   ```

**Verify:** test card `4242 4242 4242 4242` → checkout succeeds → webhook lands → `subscriptions` row inserted with `tier='team'`, `status='active'`. Run:

```bash
ssh prod
docker exec <listbull-container> psql $DATABASE_URL -c \
  "SELECT workspace_id, tier, status, current_period_end FROM subscriptions ORDER BY created_at DESC LIMIT 5;"
```

### Step 2 — Iyzico production setup (TR-locale users)

1. Iyzico dashboard → create subscription pricing plans:
   - **Team** — ₺179/ay
   - **Workspace** — ₺549/ay
2. Note each plan's reference code.
3. Iyzico → webhook URL: `https://prod.listbull.org/api/webhooks/iyzico`
4. Note webhook secret.
5. Dokploy prod env:
   ```
   IYZICO_API_KEY=xxx
   IYZICO_SECRET_KEY=xxx
   IYZICO_BASE_URL=https://api.iyzipay.com
   IYZICO_WEBHOOK_SECRET=xxx
   IYZICO_PLAN_TEAM=plan_team_ref_code
   IYZICO_PLAN_WORKSPACE=plan_workspace_ref_code
   ```

**Verify:** Mini App user with `locale='tr'` clicks Upgrade → checkout routes to Iyzico hosted form (URL contains `iyzipay.com/payment/iyzipos/checkoutform`) → real card sandbox charges → webhook lands → `subscriptions` row with `provider='iyzico'`, `status='active'`.

### Step 3 — Idempotency swap to Upstash KV

The Phase 4.5 in-memory idempotency cache is single-pod safe but
fails on multi-pod deploys (Stripe replays could be processed by
two pods).

1. Sign up for Upstash → create a Redis database (free tier OK)
2. Note REST URL + token.
3. `npm install @upstash/redis @upstash/ratelimit`
4. Replace `src/lib/billing/idempotency.ts` with Upstash-backed
   version:

   ```ts
   import "server-only";
   import { Redis } from "@upstash/redis";
   const redis = new Redis({
     url: env.UPSTASH_REDIS_REST_URL!,
     token: env.UPSTASH_REDIS_REST_TOKEN!,
   });
   const TTL_S = 24 * 60 * 60;
   export async function isReplay(eventId: string): Promise<boolean> {
     const key = `webhook:${eventId}`;
     // SET ... NX returns OK on first write, null on replay.
     const set = await redis.set(key, "1", { ex: TTL_S, nx: true });
     return set === null;
   }
   ```

5. Update both webhook handlers (Stripe + Iyzico) to await the now-
   async `isReplay`.
6. Dokploy prod env:
   ```
   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=xxx
   ```

**Verify:** trigger the same Stripe event twice via `stripe trigger`;
second delivery should return `{ ok: true, replayed: true }` without
mutating subscriptions.

### Step 4 — Flip tier enforcement to active

Once Stripe + Iyzico + idempotency are verified:

```bash
# Dokploy prod env
BILLING_ENFORCE=true
```

This makes `tier-enforce.ts` middleware reject 402 on tier-exceeded
actions instead of just logging. Audit the past 7 days of logs for
`would-deny` entries before flipping — false positives in the
log-only period predict false denials post-flip.

```bash
ssh prod
docker logs <listbull-container> 2>&1 | grep "would-deny" | tail -50
```

If the log shows surprising `would-deny` entries on currently-
working flows, fix `checkTier` before flipping.

### Step 5 — BotFather production bot

If still on test bot:

1. @BotFather → /newbot → set production username
2. Copy token → `TELEGRAM_BOT_TOKEN` env in Dokploy prod
3. Set webhook (one-time):
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://prod.listbull.org/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
4. Configure bot commands (optional, for / autocomplete in Telegram):
   ```
   start — Sıfırdan başla
   lists — Listelerimi göster
   share — Bir listeyi paylaş
   snapshot — Read-only paylaşım URL'si üret
   help — Yardım
   reset — Konuşma geçmişini sil
   ```
5. Configure Mini App URL (BotFather → /setmenubutton):
   - URL: `https://prod.listbull.org/app`

**Verify:** send `/start` to production bot → reply is the welcome
copy + Inbox creation succeeded → `users` table gets a new row
linked via Telegram ID.

### Step 6 — Repo public

GitHub → Settings → Change visibility → Public.

**Pre-flight:**
- [ ] Run `gitleaks detect --source=. --no-git` one final time → 0 findings
- [ ] Verify `.env*` is fully gitignored (only `.env.example` committed)
- [ ] README onboarding works on a clean machine (clone → docker-compose up → bot responds)
- [ ] LICENSE present (MIT) + CONTRIBUTING.md (already in `dev`)

### Step 7 — Production cutover

```bash
# Local
git checkout main
git merge --ff-only dev
git push origin main
# Dokploy auto-deploys to prod
```

After the first prod request:

```bash
# Run the Phase 4.5 migration on prod (only if not already applied)
ssh prod
docker exec <listbull-container> npm run db:migrate
docker exec <listbull-container> npx tsx src/lib/server/migrations/workspace-pivot.ts
# Verify post-migration with the architect-pass verification queries:
docker exec <listbull-container> psql $DATABASE_URL -f /app/scripts/verify-phase-4.5.sql
```

(verify-phase-4.5.sql doesn't exist yet — copy queries from
`docs/architecture-pass-phase-4.5.md` § "Verification post-migration"
into a script if you want a one-shot runner.)

## Phase 5 verification (operator-run on prod)

After Steps 1-7:

- [ ] Real customer signup via Stripe (test card → real card → tier upgrades)
- [ ] Real TR customer signup via Iyzico
- [ ] Past-due grace + 7-day → read-only flow tested via Stripe CLI clock manipulation
- [ ] Multi-bot: register a second bot via Workspace settings, verify webhook lands on `/api/telegram/webhook/<new_bot_id>`, reminder dispatched from new bot for items in that bot's workspace
- [ ] Multi-bot isolation: webhook hitting `/api/telegram/webhook/<bot_id>` with payload from a different bot ID → 401/404
- [ ] Marketing landing v2 reads correctly in TR + EN locales (Accept-Language toggle)
- [ ] Repo public on GitHub, README onboarding works on clean machine
- [ ] BILLING_ENFORCE=true → tier-exceeded rejections return 402 + upgrade CTA
- [ ] Lighthouse a11y ≥95 on https://prod.listbull.org/lists

## Phase 6 trigger (deferred)

Phase 6 (self-host license + admin dashboard) starts when:
- 30 days of SaaS data shows clear self-host demand, OR
- ≥10 GitHub issues request a license-key flow

Phase 6 work surface (when triggered):
- Architect: license schema + JWT signing key rotation
- Billing-agent: license issuance endpoint + JWT signer (payload shape already frozen in `src/lib/types/billing.ts`)
- Backend: admin dashboard backend
- Frontend: admin dashboard UI for Workspace-tier admins
- Reviewer: license forgery audit

Phase 4.5 already shipped:
- `src/lib/server/middleware/license-verify.ts` (default DISABLED)
- `LICENSE_VERIFY_ENABLED` + `LICENSE_PUBLIC_KEY` + `LICENSE_KEY` env keys
- `LicensePayload` + `LicenseVerifyResult` types

So Phase 6 implementation is just "fill in the issuer + admin UI"; no schema changes.

## Risks documented

1. **Iyzico checkout customer fields** (`src/app/api/billing/checkout/route.ts`): we don't store user surname / city / address; we synthesize defaults ("User", "Istanbul", "n/a", "Turkey"). Iyzico may flag this as a fraud signal. Phase 5+ enhancement: capture proper billing address at checkout (extra Mini App form step).
2. **Bot instance pool memory** (`src/lib/server/bot/index.ts`): cached indefinitely. ~5MB per bot × 100 paying customers × Workspace tier = ~500MB. Acceptable for Phase 5 launch; Phase 6+ adds LRU eviction.
3. **In-memory idempotency before Step 3**: Phase 4.5's idempotency.ts is single-pod safe. If you scale to >1 pod before Step 3, Stripe replays can double-process. Mitigated by the upserts being idempotent themselves (subscriptions UNIQUE on workspace_id), but Iyzico's flow is more sensitive — do Step 3 BEFORE multi-pod.
4. **bot_users table not yet checked in reminder dispatch**: Phase 5 reminder fallback is "try white-label, on 403 retry default." Better: pre-check `bot_users` to know which bot the recipient can receive from. Phase 5.5 if recipient-side bot adoption becomes a friction point.
5. **Iyzico subscription status reverse-mapping**: `iyzicoEventToStatus` covers PAID/RENEWED/ACTIVATED/FAILED/CANCELED/EXPIRED. Other event types (e.g. SUBSCRIPTION_UPGRADED) just log + ignore. Re-audit after first month of production traffic.

## Conclusion

Phase 5 ships clean on commit `be34907` plus this doc. CI green; 78
tests passing; lint clean. All code-side Phase 5 deliverables are
on `dev` branch waiting for the operator launch sequence above.
