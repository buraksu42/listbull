# Backlog

> Future work tracked here. Not scoped into a phase yet — promote to a
> phase doc + handoff when picked up. Anti-list rules in
> `project-state.md` § "What's NOT shipped" still apply; entries below
> are wedge-aligned (Telegram-native AI list assistant).

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

---

## Promotion checklist (when picking up)

- Decide whether a single phase covers both or split (recommend split:
  voice = Phase 13, attachments = Phase 14).
- Architect pass: schema diff, type contracts, storage layout.
- Operator handoff: STT provider keys, storage bucket sizing.
- Anti-list re-check: keep wedge tight — voice + attachments augment
  the list flow; don't drift into media library territory.
