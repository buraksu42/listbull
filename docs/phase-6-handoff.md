# Phase 6 — Self-Host License + Admin Dashboard (operator handoff)

> Generated 2026-05-06.
> Phase 6 closes here from a code perspective. Self-host issuance +
> admin dashboard live; operator-side keypair generation and
> deployment wiring required before going live.
>
> Reference: `docs/architecture-pass-phase-4.5.md` § "Phase 6 —
> Self-Host License & Admin (post-launch)" + `src/lib/types/billing.ts`
> (frozen LicensePayload shape).

## Status

| Phase 6 work | Code status | Operator action |
|---|---|---|
| `licenses` table + Drizzle migration | Shipped (commit `fc2d53e`) | `npm run db:migrate` on prod |
| Ed25519 keypair generator | Shipped (`scripts/generate-license-keypair.ts`) | Run once + store keys |
| License JWT signer + issuance endpoint | Shipped | Set `LICENSE_PRIVATE_KEY` + `LICENSE_ADMIN_TOKEN` |
| License revocation table column + admin DELETE | Shipped | None |
| Public revocation list endpoint (`/api/license-revocations`) | Shipped | None |
| License-verify middleware (async + revocation-aware) | Shipped (commit `fd6e50d`) | Self-host: configure env |
| Workspace admin dashboard (`/workspace/admin`) | Shipped (commit `926027f`) | None |
| License email delivery (Resend) | Deferred | Phase 6.5 if needed |
| License purchase flow (UI) | Deferred | Manual issuance via API for now |

## Operator setup — SaaS issuer side

### Step 1 — Generate Ed25519 keypair (once)

```bash
npx tsx scripts/generate-license-keypair.ts
```

Stdout prints two PEM blocks:

1. **PRIVATE KEY** → set as `LICENSE_PRIVATE_KEY` env on the SaaS issuer (Dokploy prod). Treat as a top-tier secret. Never commit. Never log.
2. **PUBLIC KEY** → bundle with every self-host deployment as `LICENSE_PUBLIC_KEY`. Ships in your README / install instructions; not secret.

### Step 2 — Configure SaaS env

```
LICENSE_PRIVATE_KEY=<PEM block>
LICENSE_ADMIN_TOKEN=<long-random-string-for-admin-API-auth>
```

`LICENSE_PRIVATE_KEY` enables `issueLicense` to sign JWTs.
`LICENSE_ADMIN_TOKEN` gates `/api/admin/licenses{,/[id]}` endpoints.

### Step 3 — Issue a license (manual, via API)

```bash
curl -X POST https://prod.listbull.org/api/admin/licenses \
  -H "x-listbull-admin-token: $LICENSE_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "tier": "workspace",
    "seats": 15,
    "email": "operator@example.com",
    "workspaces": ["00000000-0000-0000-0000-000000000001"]
  }'
```

Response includes `data.jwt` exactly ONCE. Store externally. Subsequent reads via `GET /api/admin/licenses` only return public metadata.

For Stripe/Iyzico-driven issuance (Phase 6.5), wire the webhook handler to call `issueLicense({sourceProvider: "stripe", ...})` on a successful one-time payment for a self-host SKU.

### Step 4 — Revoke a license

```bash
curl -X DELETE https://prod.listbull.org/api/admin/licenses/<license-id> \
  -H "x-listbull-admin-token: $LICENSE_ADMIN_TOKEN"
```

Sets `licenses.revoked_at`. Self-host instances see it on the next revocation refresh (max 1h after revocation, depending on their `LICENSE_REVOCATION_URL` configuration).

## Operator setup — self-host side

### Step 1 — Configure verify env

```
LICENSE_PUBLIC_KEY=<PEM block from issuer>
LICENSE_KEY=<the JWT delivered by SaaS issuer>
LICENSE_VERIFY_ENABLED=true
LICENSE_REVOCATION_URL=https://prod.listbull.org/api/license-revocations
```

`LICENSE_VERIFY_ENABLED=true` flips the middleware from no-op to active gate. `LICENSE_REVOCATION_URL` is optional — when unset, revocation cannot propagate without phone-home; license still expires via `exp` claim.

### Step 2 — Verify license loads cleanly on startup

```bash
docker exec <listbull-container> node -e "
import('./dist/lib/server/middleware/license-verify.js').then(async (m) => {
  const r = await m.verifyLicense(process.env.LICENSE_KEY);
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expected: `{ ok: true, payload: {...} }`. On failure, `reason` is one of `missing_key` / `invalid_signature` / `expired` / `revoked` / `workspace_not_allowed`.

## Workspace admin dashboard

Workspace-tier owner + admin → `/workspace/admin` from settings. Surfaces:

- Members count
- Lists count
- Items (open + done)
- Activity volume (last 30 days)

Phase 6.5+ extensions:

- Audit trail timeline (workspace_member_added/removed/role_changed events with actor + timestamp)
- License key visibility (self-host operator's bundled JWT)
- OpenRouter spend visualization (Phase 7+ if signal warrants)

## Security audit (P6-D summary)

### Forgery surface

License JWT signature path:

1. `header.payload.signature`, base64url
2. `signature` = Ed25519(`LICENSE_PRIVATE_KEY`, `header.payload`)
3. Verifier: `createVerify("SHA512").verify(LICENSE_PUBLIC_KEY, signature)`

Forgery requires either possession of `LICENSE_PRIVATE_KEY` (operator must keep secret) or a discrete-log break on Ed25519 (out of scope for Phase 6 threat model).

Mitigations in place:

- Header `alg` is NOT trusted from JWT; verifier hardcodes Ed25519 path. JWT-spec "alg=none" attack moot.
- Private key never logged, never returned via API, only present in env.
- Admin endpoint requires `LICENSE_ADMIN_TOKEN` header — separate secret from `LICENSE_PRIVATE_KEY` so a leaked admin token alone doesn't sign JWTs.

### Replay surface

Issued license JWTs are reusable until `exp` or revocation. Revocation:

- SaaS-side: `licenses.revoked_at` set via DELETE.
- Self-host: refreshes `LICENSE_REVOCATION_URL` every 1h; on fetch failure retains last-known-good list.

Tightest revocation latency: 1h (configurable via `REVOCATION_TTL_MS` constant in `src/lib/server/middleware/license-verify.ts`).

### Admin permission boundaries

- `/api/admin/licenses{,/[id]}`: gated by `x-listbull-admin-token`. No Telegram session — pure operator surface. 503 when env unset (self-host without issuance configured).
- `/workspace/admin` Mini App route: gated by `active.tier === "workspace" && (role === "owner" || role === "admin")`. Tier OR role mismatch → redirect to `/workspace/settings`. Server-rendered; no client-side trust.
- License revocation endpoint (DELETE): same admin-token gate as issuance. Cannot be triggered by workspace members.

### Untrusted input handling

- Issuance POST body: tier whitelist (team / workspace), seats integer, email string, workspaces array of strings. Rejects garbage payloads with 400.
- Verify path: signature check before any payload trust. Malformed JWT → `invalid_signature`. Payload JSON.parse wrapped in try/catch.

### What's NOT covered

- Live phone-home revocation: not implemented. Self-host instances honor revocation up to 1h after publication.
- Per-route rate limiting on admin endpoints: no protection against credential-stuffing if `LICENSE_ADMIN_TOKEN` leaks. Operator should rotate the token periodically and front the route with a WAF / Dokploy access control if exposure is a concern.
- License clock-skew tolerance: `exp` validation uses local `Date.now()`. Self-host instances on heavily-skewed clocks may reject not-yet-expired licenses. Acceptable; operators run NTP.

## Phase 6.5+ scope (deferred)

- License email delivery via Resend (auto-send issuance results)
- Stripe/Iyzico SKU + webhook handler that calls `issueLicense` automatically on payment success
- Audit trail timeline UI on the admin dashboard (currently just headline counts)
- Bulk restore UI (workspace-wide undo of last N delete events)
- OpenRouter spend telemetry on Workspace tier (cost per member / per day)

## Conclusion

Phase 6 ships clean on commit `926027f` plus this doc. CI green; 78 tests passing; lint clean. Self-host issuance + verification + revocation all functional, gated by env. SaaS deploy unaffected when license envs are unset.

Phase 7 trigger (deferred): once Phase 5 launches and Phase 6 self-host enrollment confirms the license flow works end-to-end, revisit for audit timeline UI, automatic license issuance via Stripe webhook, license-bound seat enforcement at runtime.
