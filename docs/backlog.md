# Backlog

> Future work tracked here. Not scoped into a phase yet — promote to a
> phase doc + handoff when picked up. Anti-list rules in
> `project-state.md` § "What's NOT shipped" still apply; entries below
> are wedge-aligned (Telegram-native AI list assistant).

## Cross-cutting principle: bot ↔ Mini App parity

Every action available via text command must be reachable from the Mini
App, and vice versa. New features added to one surface MUST land on the
other in the same phase (or with a tracked follow-up issue if the
parity work is genuinely larger).

Known gaps as of 2026-05-08 (backfill candidates — file as smaller
PRs rather than a single phase):

- Item edit: status / priority / tags pickers (CLOSED 2026-05-08).
- Item move (cross-list) from the Mini App row UI — bot has it via
  `update_item.target_list_*`, Mini App has no UI for it yet.
- Recurrence_rule editor in the item-edit-sheet — schedule_reminder
  accepts it; Mini App can't display or change recurrence.
- Workspace switch in bot — Mini App has the header dropdown; bot has
  `switch_workspace` but no slash command.
- `/snapshot` initiation from the Mini App — bot has `share_list`
  with `as_snapshot=true`; Mini App needs a "Share as snapshot" item.
- Settings per-field reach via bot — bot has `update_settings` for
  locale/timezone/model/notifications; needs verification BYOK key
  rotation works via bot too.

## Multimodal input + attachments

### 1. Voice messages (input + reply)

Bot should accept Telegram voice / audio messages and route them through
the same LLM router as text:

- Inbound: `voice` / `audio` / `video_note` updates → transcribe via a
  speech-to-text path (OpenAI Whisper, Deepgram, or Telegram's own STT
  if exposed via Bot API) → feed transcript into existing LLM router
  unchanged. BYOK API key reused or operator-side fallback for STT.
- Outbound (optional): for replies that warrant audio (long lists read
  aloud, accessibility), TTS via the same provider. Gated by a per-user
  preference (`/settings`) since audio replies are intrusive.
- Cost tracking: add STT/TTS rows to `llm_usage` (or a sibling table).
  Workspace caps + sparkline (Phase 8/9) extended accordingly.

Surface area: 1 webhook handler branch, 1 STT client, 1 settings flag,
~2 schema cols. Test fixtures need an actual `.ogg` sample.

### 2. Image / video / file attachments on items

Items currently store only `text`. Add an attachment surface:

- Bot inbound: `photo` / `video` / `document` / `animation` updates →
  upload to Hetzner Object Storage (already wired for F1 export) →
  store URL + mime + size on the related item.
- Schema: new `item_attachments` table (1-to-many: item_id, url,
  mime_type, size_bytes, file_name, created_at). Avoid bloating `items`.
- Mini App rendering: thumbnail in list view; tap to open in Telegram's
  in-app viewer.
- LLM context: forward attachment metadata (URL, mime, dimensions) to
  the model so it can reason ("Pazartesi yemek listesi fotoğrafı sende"
  → recall the photo URL).
- Storage caps: per-workspace attachment quota (matches the BYOK / cost
  caps pattern in `workspace_member_caps`).

Surface area: 1 schema migration, 1 upload helper, 1 webhook branch per
content type, Mini App attachment renderer, optional LLM tool
(`attach_to_item`).

### 2b. Item description + Telegram-native attachments

Refines (and partly supersedes) entry #2's storage choice. Two
adjacent additions:

- **Item description / notes** — second freeform text column on items
  (e.g. `description text`, nullable, ~10kb cap). Edit Sheet adds a
  multi-line textarea below the title. LLM tools (`create_item`,
  `update_item`) accept an optional `description` field. Bot replies
  surface it as an indented secondary line, only when present.
- **Attachments via Telegram storage** — when the user sends a photo /
  video / document / audio in the bot chat (or attaches via the Mini
  App which forwards to the bot), capture Telegram's `file_id` +
  `file_unique_id` + mime + size and store on a new `item_attachments`
  table. NO Hetzner Object Storage hop — the file already lives on
  Telegram CDN, and the Mini App can render previews via Bot API
  `getFile` → temporary URL (cache the URL until expiry).
- Trade-off: `file_id` is bot-token-scoped — if the bot is
  regenerated, file IDs invalidate. Mitigation: store the `file_id`
  per-bot (default platform vs. workspace white-label) so workspaces
  with their own bot upload through that bot directly. Document the
  rotation hazard in the operator runbook.
- Mini App rendering: thumbnail strip below the item's text;
  full-screen preview opens in Telegram's native viewer via
  deep-link. Activity feed entries record attach/detach so audit/F2
  restore can reconstruct.

Surface area: 1 schema migration, attachment-extract handler in the
bot webhook, optional LLM tool (`attach_to_item`), edit-sheet
description textarea + attachment list.

### 2c. User-configurable date / time format

`<input type="datetime-local">` honors the browser's system locale, not
the user's listbull preference. TR users see "08.05.2026 12:30"
correctly; US users land on "05/08/2026, 12:30 PM" etc. — the field
silently flips. Bot replies face the same drift via `Intl.DateTimeFormat`'s
default style.

Plan:

- New column `users.date_format` (`"dmy_dot" | "mdy_slash" | "ymd_dash"
  | "iso"`) + `users.time_format` (`"24h" | "12h"`). Default to
  `dmy_dot` + `24h` for TR locale, `mdy_slash` + `12h` for en, ISO
  fallback otherwise.
- `update_settings` LLM tool gains both fields so users can switch via
  bot command ("tarih formatım Amerikan olsun" → `update_settings({
  date_format: "mdy_slash", time_format: "12h" })`).
- Mini App settings page surfaces both as radio groups.
- All date rendering (audit feed, item rows, edit-sheet input,
  reminder annotations, activity timeline) routes through one helper
  `formatUserDate(iso, user) / formatUserTime(...)` that reads the
  prefs.
- Replace `<input type="datetime-local">` with a controlled date+time
  picker (probably `react-day-picker` for the calendar + a 24h-aware
  time input) so the browser locale stops hijacking the display.
- Bot side: `Intl.DateTimeFormat(locale, { ... })` calls accept the
  prefs and emit consistent strings.

Surface area: 1 schema migration, 1 helper module, 1 settings tool +
schema update, 1 picker component swap, ~5 call-site touch-ups. Not
bot-blocking but high visibility: the format flips silently between
devices today.

### 2d. Decouple deadline from reminder

Today `items.due_at` is the SAME column as the cron firing time —
setting a deadline ALWAYS schedules a DM at that exact moment, with
no option for "due Friday but ping me Thursday at 18:00." UX-wise the
two concepts are independent and the bot should treat them so.

Plan:

- `items.deadline_at` (nullable timestamptz) — semantic deadline,
  used for sort order, overdue badge, /views/today + /views/week
  aggregates. No cron pickup off this column.
- `item_reminders` table (1-to-many: `id`, `item_id`, `remind_at`,
  `offset_minutes_before_deadline` nullable, `reminder_sent` boolean,
  `recurrence_rule` text nullable). Cron picks up rows where
  `remind_at <= now() AND reminder_sent = false`. `offset_*` lets
  users say "1 hour before deadline" — when deadline shifts, the
  reminder shifts too.
- Migration plan: existing `due_at` becomes `deadline_at` AND we
  back-fill an `item_reminders` row per item so existing reminder
  semantics keep firing. `recurrence_rule` migrates onto the new
  reminders table (it already lives on items today, so a 1-row
  attachment).
- Tool surface:
  - `create_item` / `update_item`: `deadline_at` becomes the deadline
    field. `due_at` stays as a deprecated alias for one release.
  - `schedule_reminder` becomes `add_reminder` (multi-shot) plus
    `clear_reminders`. Each reminder accepts absolute time OR
    relative offset (`{ offset: { minutes_before_deadline: 60 } }`).
  - LLM prompt examples cover "yarın 18:00 deadline + 1 saat önce
    bana hatırlat" → both fields filled.
- UI (Mini App): edit-sheet splits into two rows — "Deadline" (date+
  time picker, optional) and "Reminders" (chip list with quick presets
  "deadline'da", "1 saat önce", "1 gün önce" + "custom"). Bot reply
  rendering keeps the trailing ⏰ badge but learns to combine the two
  pieces of info ("deadline yarın 18:00, hatırlatma 17:00").
- Surface area: 1 schema migration (sizeable — new table), cron
  pickup query rewrite, 6 LLM tool descriptions touched, 2 Mini App
  components, ~12 call-site touch-ups.

This is the single biggest semantic refactor in the queue — promote
to its own phase rather than bundling with anything else.

### 3. Weekly + calendar deadline views

Phase 4.5 ships `/views/today` (workspace-scoped due-today aggregate).
Extend to a deadline-driven calendar surface:

- `/views/week` — Monday–Sunday rollup of items with non-null `due_at`,
  grouped by day. Re-uses the today-view aggregate query with a
  bounded date range. Empty days collapse to a thin row.
- `/views/calendar` (optional) — month grid with day cells showing
  item count + a hover/tap drill-down. Only meaningful in Mini App;
  bot-side stays at today/week digests.
- Bot digest: optional daily 09:00 (or user-configured time) DM
  summarizing today's deadlines, gated by the existing notifications
  toggle. Reuses the cron container — new tick handler alongside
  `dispatch-reminders.ts`.
- Filter parity: same status/priority/tag chips as `/lists/[id]`
  (Phase 7) so users can narrow the calendar.

Surface area: 1 query helper (`getDeadlineRange`), 2 routes
(`/views/week`, optionally `/views/calendar`), 1 cron handler for the
digest, ~0 schema changes (data already exists).

---

## Promotion checklist (when picking up)

- Decide whether a single phase covers each or split (recommended:
  voice = Phase 13, attachments = Phase 14, calendar views = Phase 15).
- Architect pass: schema diff, type contracts, storage layout.
- Operator handoff: STT provider keys, storage bucket sizing.
- Anti-list re-check: keep wedge tight — voice + attachments augment
  the list flow; don't drift into media library territory.
