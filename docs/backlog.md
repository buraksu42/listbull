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
