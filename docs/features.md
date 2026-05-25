# Features

> All features below ship on `dev` and `main`. Historical (pre-Phase-17)
> features are in [`archive/`](./archive/) — not current.

## Capture

### Natural-language item capture
Send a free-form message; the LLM extracts action items and creates
them via the `create_item` tool. Examples:

```
süt al
yarın 9'da diş hekimi
ekmek al, çıkışta hatırlat
```

Up to 20 distinct items per forwarded message in a single turn.

### Voice notes
Voice messages (OGG) are transcribed via OpenRouter
`google/gemini-2.5-flash` (input_audio) and routed through the same
capture path.

- **DM**: every voice note is processed.
- **Group**: ambient listening. The bot adds items if the transcript
  contains a clear to-do; otherwise stays silent (no token waste).

Voice STT requires a paid model — disabled when the chat is on the
free-tier shared key.

### Photo / document / file attachments
Bot uploads are linked to the most recently mentioned item via the 📎
button. Stored as Telegram `file_id` references; zero local storage.

## Organize

### Lists per chat
Each Telegram chat is one to-do context. `/items` shows the open
to-dos for the current chat only.

### Checklist (parent + sub-items)
"Haftalık temizlik: çamaşır, bulaşık, çöp" → creates a parent +
3 children. In `/items` the parent shows as `📂 0/3`; tap to drill
into the sub-items view.

- **Gate-complete**: parent cannot be marked done while any child is
  open. The bot surfaces open children and asks to cascade.
- **Cascade-archive**: deleting a parent archives all children in
  the same transaction; confirmation phrase reads
  `"haftalık temizlik ve 3 alt item silinecek"`.
- **Depth**: one level only (no grandchildren).

### Memory mode
For long-lived keepsakes (tickets, docs, receipts):

```
konser biletini hafızaya al
```

Listed under `/memory`. Never auto-archived; deletion requires
explicit confirmation.

### Tags and tag-based assignment
- Free-form: `ekmek al #market` → tagged `market`.
- Assignment: `raporu Michael'a ata` → tagged `michael`. Tag IS the
  assignment surface (no separate `assigneeId` column).
- Query: `/tag market` or `/tag michael` → open items under that tag.

### Smart views
- `/today` — items with a deadline today
- `/thisweek` — items due in the next 7 days
- `/reminders` — pending reminders

## Reminders

Natural-language scheduling (`"süt al'ı 1 saat sonra hatırlat"`) or
the ⏰ button preset menu. Cron container polls every 60s.

Routing:
- **DM item** → reminder fires to the user's DM.
- **Group item** → reminder fires to the originating group (not DM).

Multiple reminders per item supported; RRULE (recurring) supported.

## Secrets (`/password`)

DM-only save flow, 3 force-reply steps: **label → username →
password**. Encrypted with AES-256-GCM via `ENV_KEY`; only the
encrypted blob and the last-4 suffix are stored.

- `/password list` — labels + suffixes (never plaintext).
- `/password view <label>` — reveals as a 15-second self-destruct
  Telegram message with HTML `<code>` for tap-to-copy.
- Save is always in DM; reveal works in the group the secret was
  saved for, as long as the requester is a chat member.

See [`SECURITY.md`](../SECURITY.md) for details with source
permalinks.

## Conversational features

### `/onboarding`
8-step interactive walkthrough (`commands/onboarding.ts`). Edits a
single message in place via `editMessageText`; user advances with
`[Devam ▶]` or exits with `[Atla ✗]`. Stateless — current step lives
in the callback data.

Triggered via:
- The slash command `/onboarding`
- The "🎯 Hızlı tur (3 dk)" inline button on `/start`'s welcome

### `/settings`
One-screen toggle panel: language (TR/EN), notification opt-in,
date format, time format, plus your OpenRouter key (set via force-
reply paste; remove falls back to the operator's free-tier key).

### `/reset`
Clears the conversation context for this chat (does not touch items
or memory).

## LLM tooling

- **Default model**: `anthropic/claude-haiku-4-5-20251001`. Users
  can override per-chat by setting a key in `/settings`.
- **Free-tier fallback**: when a chat has no key, the bot uses
  `LISTBULL_SHARED_OPENROUTER_KEY` + `LISTBULL_FREE_MODEL` (defaults
  to `openrouter/free`). Free-tier users see a one-time nudge to
  upgrade for higher-quality models; subsequent messages don't repeat.
- **Tool surface**: zod-typed tools (create / search / update /
  complete / delete item, add / remove reminder, save / reveal
  secret). Every executor wraps in a single Drizzle transaction +
  writes an `activity_log` row.

## Self-host posture

- Single Docker compose stack: `postgres` + `app` + `cron`.
- BYOK by default; optional operator shared free-tier key.
- No telemetry by default — Sentry + Umami are opt-in via build args.
- No managed dependencies. Self-host on a 5€ VPS works.
- Per-user hourly message cap (`LISTBULL_PER_USER_HOURLY_MSG_LIMIT`)
  for runaway-cost protection.
