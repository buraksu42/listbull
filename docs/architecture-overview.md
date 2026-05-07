# listbull architecture overview

> Top-level project map after Phases 1 → 10. For phase-specific
> contracts see the architect-pass docs (`architecture-pass-phase-*.md`)
> and operator handoffs (`phase-*-handoff.md`).

## Surface map

```
┌────────────────────────────────────────────────────────────────────┐
│                         Telegram Update                             │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ webhook (per-bot URL)
            ┌──────────▼──────────┐
            │ /api/telegram/      │
            │   webhook[/botId]   │
            └──────────┬──────────┘
                       │ grammY bot pool (LRU 50)
            ┌──────────▼──────────┐
            │ handleMessage       │
            │  ├ rate limit       │
            │  ├ BYOK chain       │  user → workspace → operator
            │  ├ workspaceId      │
            │  └ respond.ts       │
            └──────────┬──────────┘
                       │ Anthropic SDK → OpenRouter
            ┌──────────▼──────────┐      ┌────────────────┐
            │ LLM (24 tools)      │◀────▶│ Tool dispatcher│
            │  + system.v4 prompt │      │ (executors)    │
            └──────────┬──────────┘      └───┬────────────┘
                       │                     │
                       ▼                     ▼
              ┌──────────────────────────────────┐
              │ Postgres (drizzle 0001-0006)     │
              │  18 tables                       │
              └──────────────────────────────────┘
                       │
            ┌──────────┴──────────────────────┐
            │                                 │
   ┌────────▼─────────┐              ┌────────▼─────────┐
   │ Mini App         │              │ Cron containers  │
   │  /lists          │              │  - reminders     │
   │  /workspace/...  │              │  - cleanup-stale │
   │  /settings       │              └──────────────────┘
   │  /billing/...    │
   └──────────────────┘
```

## Tables (18)

| Table | Purpose | Phase |
|---|---|---|
| `users` | Telegram user records, BYOK key, locale, active workspace | 1 |
| `lists` | List shells, workspace_id (Phase 4.5+) | 1 |
| `list_members` | Per-list membership (owner/editor/viewer) | 1 |
| `items` | Items + status/priority/tags (Phase 4.5+) | 1 |
| `messages` | LLM conversation history | 2 |
| `list_invites` | Per-list invite tokens | 3 |
| `activity_log` | Dual-purpose feed + audit/restore | 3 |
| `workspaces` | Workspace shell + tier + memberLimit + org-key | 4.5 / 5.5 |
| `workspace_members` | Workspace membership (owner/admin/editor/viewer/guest) | 4.5 |
| `subscriptions` | Stripe/Iyzico subscription state | 4.5 |
| `billing_customers` | Provider-locked customer records | 4.5 |
| `bots` | Default + white-label Telegram bots, encrypted token | 4.5 / 5 |
| `workspace_bots` | M:M binding workspace ↔ bot | 4.5 |
| `bot_users` | Records who's `/start`'ed each bot | 4.5 |
| `workspace_invites` | Workspace-level invite tokens | 5.5 |
| `licenses` | Self-host license issuance + revocation | 6 |
| `llm_usage` | Per-turn token + cost telemetry | 7 |
| `workspace_member_caps` | Per-member daily/monthly USD caps on org-key | 8 |

## Key flows

### LLM turn

1. Telegram update → `/api/telegram/webhook[/botId]` → grammY bot pool
2. `handleMessage`:
   - per-user rate limit (Phase 10)
   - user lookup; if missing → "Run /start first"
   - locale + copy + workspaceId resolution
   - BYOK chain: `users.openrouter_api_key_encrypted` (decrypt) →
     `workspaces.openrouter_api_key_encrypted` (Workspace tier) →
     `env.OPENROUTER_API_KEY` (operator fallback) → `noKey` reply
   - cap check (only when keySource === 'workspace')
   - history slice + workspace summary fetch
3. `respond.ts`:
   - system.v4 prompt with workspace + user context
   - Anthropic SDK ↔ OpenRouter, tool-call loop (≤5 round-trips)
   - cumulative usage + provider cost accumulation
4. Tool dispatcher:
   - 24 executors, each scoped by `ctx.workspaceId`
   - single transaction per executor (write + activity_log)
5. Persist: messages + `llm_usage` row (token count + cost)
6. Reply: Telegram sendMessage (plain text per CLAUDE.md `parse_mode` rule)

### Billing event

1. Stripe webhook (`/api/webhooks/stripe`) or Iyzico webhook
2. Signature verify + idempotency check (Upstash KV)
3. Subscription upsert (workspace_id from session metadata)
4. `workspaces.tier` cache refresh + `member_limit` update
5. (Stripe self-host SKU only) `issueLicense` + Resend email

### License verification (self-host)

1. Self-host instance boot reads `LICENSE_PUBLIC_KEY` + `LICENSE_KEY`
2. `verifyLicense`:
   - JWT signature check (Ed25519, hardcoded alg — no `alg=none`)
   - exp check
   - revocation list fetch from `LICENSE_REVOCATION_URL` (1h TTL,
     last-known-good fallback)
3. `requireLicense(workspaceId)` checks:
   - `LICENSE_VERIFY_ENABLED=true` gate
   - workspace_id in payload.workspaces allowlist

### Reminder dispatch

1. Cron container runs `dispatchReminders` every 60s
2. Pickup query: `due_at <= now() AND reminder_sent = false`
3. Per row: route via workspace-bound bot (Phase 5) → fallback
   default bot on 403
4. Conditional UPDATE flips `reminder_sent` only on successful send

## Invariants

(referenced throughout the codebase as `Inv-N`)

| # | Invariant |
|---|---|
| 1 | Entity write + activity_log write atomic per executor |
| 2 | List access requires list_members row (workspace_id ∩ list_members) |
| 3 | List resolution: id → exact name → fuzzy → Inbox fallback (per-action) |
| 4 | All executor errors return discriminated `{ ok: false, error: { code, message } }` envelope |
| 5 | Snapshots in activity_log.payload_* round-trip Date as ISO 8601 strings |
| 8 | BYOK key encrypted at rest with AES-256-GCM; plaintext never logged |
| 10 | Invite tokens are 32-byte CSPRNG, base64url, unique per active row |
| 11 | Reminder dispatch idempotent: `reminder_sent` flips only on successful send |
| 12 | Reminder DM fallback: stale assignee → owner; bot-bound 403 → default bot |
| 13 | Invite creation does NOT write activity_log (only acceptance does) |
| 14 | Soft-warning envelope: `warnings: string[]` on success responses |
| 15 | Persistent-failure detection: items >5min past due_at + reminder_sent=false log warning, no auto-retry |
| 18 | Snapshot URL signed with HMAC-SHA256 of `(listId, expiresAt)` |
| 19 | TR + EN message catalogs key-parity (Vitest gate) |
| 20 | Export bundle caller-only filter (no other users' data) |
| 21 | F2 restore window: 30 days from item_deleted activity row |

## Frozen public types

Key types live in `src/lib/types/` and are imported via `@/lib/types`:

- `User`, `List`, `ListMember`, `Item`, `Message`, `ListInvite`, `ActivityLog`
- `Workspace`, `WorkspaceMember`, `WorkspaceTier`, `WorkspaceRole`
- `Subscription`, `SubscriptionStatus`, `BillingProvider`,
  `BillingCustomer`, `TierLimits`, `LicensePayload`,
  `LicenseVerifyResult`, `License`, `LicensePublic`
- `Bot`, `WorkspaceBot`, `BotUser`, `BotPublic`
- `WorkspaceInvite`, `WorkspaceInviteTokenInfo`
- Snapshot views: `ItemSnapshot`, `ListSnapshot`, `MemberSnapshot`,
  `WorkspaceSnapshot`, `WorkspaceMemberSnapshot`

Adding to this surface requires an Architect-agent invocation per
the agents.md contract — never declare equivalents elsewhere.

## Cron jobs

| Job | Cadence | Purpose |
|---|---|---|
| `dispatch-reminders` | every 60s | Send reminder DMs for due items |
| `cleanup-stale` | daily | Prune expired invites + activity log past tier retention |

## Operator handoff index

| Doc | Phase | Topic |
|---|---|---|
| `architecture-pass-phase-2.md` | 2 | Core LLM + tool layer |
| `architecture-pass-phase-3.md` | 3 | Sharing + reminders + assignments |
| `architecture-pass-phase-4.md` | 4 | OSS quality polish |
| `architecture-pass-phase-4.5.md` | 4.5 | Workspace + billing + multi-bot pivot |
| `review-phase-4.5.md` | 4.5 | Reviewer strict-gate findings |
| `phase-5-handoff.md` | 5 | SaaS launch operator runbook |
| `phase-6-handoff.md` | 6 | Self-host license + admin operator runbook |

For the consolidated state see `docs/project-state.md`.
