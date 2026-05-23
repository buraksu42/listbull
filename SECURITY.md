# Security

> Last reviewed: 2026-05-23. Permalinks below point to `dev` (where
> all current code lives — `main` is the initial scaffold). When
> `dev` is merged to `main`, the links will be updated.

## TL;DR

- **Passwords / OpenRouter keys**: AES-256-GCM at rest; plaintext
  never written to the database, never logged, never put into the
  activity log.
- **Multi-tenant isolation**: every read/write is scoped to the
  Telegram `chatId`; callback handlers verify chat ownership before
  any mutation; the webhook authenticates via a constant-time secret
  comparison.
- **No telemetry by default**: Sentry + Umami are opt-in via env vars.
- **No managed dependencies**: self-host on a single VPS with
  Postgres; you own the data.

## 1. Encryption at rest

### Algorithm
AES-256-GCM, the standard authenticated-encryption-with-associated-data
primitive. Implementation lives in
[`src/lib/server/encryption.ts`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/encryption.ts):

- **Key source**: `ENV_KEY` environment variable, base64-decoded to
  32 bytes (256 bits).
- **IV**: 12 random bytes per encryption (GCM-recommended length).
- **Auth tag**: 16 bytes (128 bits).
- **Envelope format**: `base64(iv ‖ authTag ‖ ciphertext)` — a single
  opaque string written to a `text` column.

### What's encrypted

| Plaintext                            | Encrypted column                       | Schema reference |
|--------------------------------------|----------------------------------------|------------------|
| User's `/password` secret payload    | `items.secret_encrypted`               | [`schema.ts:179`](https://github.com/buraksu42/listbull/blob/dev/src/lib/db/schema.ts#L179) |
| Per-chat OpenRouter API key (BYOK)   | `chats.openrouter_api_key_encrypted`   | [`schema.ts:97`](https://github.com/buraksu42/listbull/blob/dev/src/lib/db/schema.ts#L97) |

Plaintext never reaches the database. The bot decrypts lazily when
the user invokes `/password view` or when the LLM needs the API key
for a single turn; the plaintext lives in process memory for the
duration of that operation and is then discarded.

### `/password` flow specifics

- **Save**: 3-step DM force-reply collect (label → username →
  password). Each step's message is deleted from Telegram
  immediately on receipt. The encrypted blob is written; the
  activity log records only `{label, secretSuffix}` (last 4 chars
  of the password), never the encrypted blob and never the
  plaintext. See
  [`handle-message.ts:1177-1189`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/bot/handle-message.ts#L1177-L1189).
- **Reveal**: decryption happens in
  [`tools/reveal-secret.ts`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/reveal-secret.ts).
  Plaintext is sent to Telegram as HTML `<code>` for tap-to-copy,
  then the message is auto-deleted after 15 seconds. The activity
  log row records only `{label, suffix}`.
- **DM-only save**: the save flow is rejected in groups; reveal works
  in the originating group as long as the requester is a chat
  member.

### Key rotation

Rotating `ENV_KEY` invalidates **every** stored ciphertext (BYOK
keys + `/password` secrets). The bot cannot decrypt them after
rotation. Plan: rotate only after telling users to re-enter their
OpenRouter key and re-save their passwords.

## 2. Multi-tenant isolation

Each Telegram chat (DM or group) is one tenant. A user must never
see another chat's items, reminders, memory, or secrets.

### Query scoping

Every database query that touches per-chat data filters on `chatId`.
Sample call sites:

- **Search**: [`tools/search-items.ts:40`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/search-items.ts#L40)
  — `eq(items.chatId, ctx.chatId)`.
- **Create / update / complete / delete**: every executor under
  [`src/lib/server/tools/`](https://github.com/buraksu42/listbull/tree/dev/src/lib/server/tools)
  scopes by `ctx.chatId` before any write.
- **Reveal secret**: [`reveal-secret.ts:67`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/reveal-secret.ts#L67)
  — looks up the secret with a `(itemId, chatId)` AND'd predicate.

### Callback-query verification

When a user taps an inline button (e.g. `item:toggle:<uuid>`), the
handler verifies the item belongs to the incoming chat before
acting. Without this, anyone who guesses a UUID could toggle another
chat's items.

[`handlers/item-action-callback.ts:130-133`](https://github.com/buraksu42/listbull/blob/dev/src/lib/server/bot/handlers/item-action-callback.ts#L130-L133):

```ts
.where(and(eq(items.id, itemId), eq(items.chatId, chatId)))
```

This pattern repeats at lines 169, 254, 291, 327, 417, 513, 587,
623, 679 — every mutation path enforces the AND.

### Webhook authentication

The Telegram webhook handler verifies the `X-Telegram-Bot-Api-Secret-Token`
header on every request using a constant-time comparison
(`crypto.timingSafeEqual`). Constant-time prevents timing oracles.

[`api/telegram/webhook/route.ts:67-72`](https://github.com/buraksu42/listbull/blob/dev/src/app/api/telegram/webhook/route.ts#L67-L72):

```ts
if (!secretsEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
  return new Response("Unauthorized", { status: 401 });
}
```

Rate-limit + idempotency middleware fire before parsing the payload.

### Force-reply contexts

The `bot_action_contexts` table maps `(chatId, messageId)` to a
pending action (e.g. "the user's next message is the secret label").
The lookup uses both components, so a hostile actor cannot replay a
message id from another chat:

[`queries/bot-action-contexts.ts:62-67`](https://github.com/buraksu42/listbull/blob/dev/src/lib/db/queries/bot-action-contexts.ts#L62-L67):

```ts
.where(and(
  eq(botActionContexts.chatId, chatId),
  eq(botActionContexts.messageId, messageId),
))
```

### Known scope-wide queries (by design)

`getAllMessagesForUser()`
([`queries/messages.ts`](https://github.com/buraksu42/listbull/blob/dev/src/lib/db/queries/messages.ts))
returns a user's own messages across all chats they participate in.
Used only by the user-data export tool — the requester is always the
data subject. Not an isolation issue.

## 3. In transit

- TLS terminates at the reverse proxy (Caddy / Traefik /
  Cloudflare). Compose binds the app to `127.0.0.1:3000` only —
  never directly Internet-exposed.
- Telegram → bot path is HTTPS with the `secret_token` header check
  above.
- LLM calls use OpenRouter's HTTPS endpoint.

## 4. Logging discipline

- No plaintext secret material is logged. The decrypt-failure path
  in `reveal-secret.ts` logs only the `itemId` and the error
  message — not the ciphertext, not the key, not the plaintext.
- Telegram bot tokens, OpenRouter API keys, and webhook secrets
  never appear in any log statement.
- The `activity_log` table is the audit trail; for secret events it
  records `{label, suffix}` only.

## 5. Reporting a vulnerability

Email **mburaksu@gmail.com** or open a private
[Security Advisory](https://github.com/buraksu42/listbull/security/advisories/new)
on GitHub.

Please **do not** open a public issue for security-sensitive bugs —
report privately so the issue can be patched before disclosure.

## 6. What we don't promise

- The Telegram client itself is out of scope. Plaintext passwords
  pass through the Telegram message DM as part of the save flow;
  Telegram operates that infrastructure. Use a long-lived,
  trusted Telegram account.
- The bot host machine is out of scope. If `ENV_KEY` leaks (server
  compromise, env dump), every encrypted blob can be decrypted.
  Treat the host as the trust boundary.
- We do not yet support hardware-backed key storage (HSM, Vault);
  `ENV_KEY` lives in process env. Future work, not current.
