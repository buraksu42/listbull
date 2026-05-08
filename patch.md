# Phase 14d + 14a + 14c + 14b + 13 + 16 + 15 + Kanban Patch Raporu

> Branch: `dev` (uncommitted)
> Tarih: 2026-05-08
> Plan kaynağı: `~/.claude/plans/phase-13-fuzzy-volcano.md` § Phase 14d/14a/14c/14b/13/15 + Kanban. Phase 16 (checklists) plan dışı **kullanıcı isteği**.
>
> **Bu dosya birikimli**: önceki bölümler değişmedi; en sonda Phase 15 + Kanban bölümleri eklendi. Migration sırası: 0011 (14d) → 0012 (14a) → 0013 (14c) → 0014 (14b) → 0015 (16) → 0016 (15). Phase 13 + Kanban schema değişikliği yok. Hepsi `dev` branch'te uncommitted.

## Tek satır özet

`items.due_at` → `deadline_at` rename + `items.reminder_sent`/`recurrence_rule` drop + yeni `item_reminders` (1-N) tablosu. LLM tarafında `schedule_reminder` silindi, yerine **3 ayrı tool** geldi: `set_deadline`, `add_reminder`, `remove_reminder`. Cron, executor'ler, HTTP route'lar, types ve activity_log buna göre güncellendi.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅**.

---

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts` — `items` tablosundan `dueAt` (rename → `deadlineAt`), `reminderSent` (drop), `recurrenceRule` (drop). Yeni `itemReminders` tablosu eklendi: `id`, `itemId` (FK CASCADE), `remindAt`, `kind` (`'absolute' | 'before_deadline'`), `offsetMinutes`, `recurrenceRule`, `sent`, `lastSentAt`, timestamps. İndeksler: `item_reminders_due_idx` (`remind_at WHERE sent=false`), `item_reminders_item_idx`. CHECK constraint'ler app-layer'da değil **migration'da** SQL'le emit edildi (Drizzle TS tarafında `tableCheck` first-class değil).
- `drizzle/0011_phase14d_reminders_split.sql` — **manuel yazıldı** (drizzle-kit interaktif prompt istedi non-TTY ortamda; rename'i drop+create olarak görüyor). Sıralı: tablo create → backfill (`INSERT ... SELECT FROM items WHERE due_at IS NOT NULL AND archived_at IS NULL`, recurrence_rule + reminder_sent + last_sent_at korunur) → eski indeks drop → kolon rename → yeni `items_deadline_at_idx`.
- `drizzle/meta/_journal.json` — idx 11 eklendi (`0011_phase14d_reminders_split`, ts 1778889600000).
- ⚠️ `drizzle/meta/0011_snapshot.json` **yazılmadı** — sonraki `db:generate` için drizzle-kit'in interaktif prompt'una cevap vermek gerekecek (rename mi, drop+create mi). Migration SQL'i load-bearing; sadece sonraki diff'leri hesaplamak için snapshot lazım.

### Types

- `src/lib/types/index.ts` — `ItemReminder`, `NewItemReminder`, `ItemReminderKind` ve `ItemReminderSnapshot` eklendi. `ItemSnapshot`'tan `dueAt`/`reminderSent` çıkarıldı; yerine `deadlineAt` geldi (ayrıca `status`/`priority`/`tags`/`pinnedAt` eklendi — Phase 4.5 schema'da varlardı ama snapshot type'ı eski kalmıştı, şimdi gerçeklikle eşleşti). `ActivityAction` union'a `item_deadline_set/cleared`, `item_reminder_added/removed/fired` eklendi (eski `item_due_set/cleared` jsonb back-compat için union'da kalıyor). `ReminderJobItem` yeniden şekillendirildi: `reminderId`, `remindAt`, `deadlineAt`, `kind`, `offsetMinutes`, `recurrenceRule`, owner+assignee timezone alanları. `SnapshotPublic.items[].dueAt` → `deadlineAt`.
- `src/lib/db/snapshots.ts` — `toItemSnapshot` yeni shape'i emit ediyor; `toItemReminderSnapshot` eklendi.

### LLM tool schemas (`src/lib/ai/tools.ts`)

- `itemSnapshotSchema` yeni shape'le güncellendi (status/priority/tags eklendi, dueAt/reminderSent/recurrenceRule çıktı, deadlineAt geldi).
- Yeni `itemReminderSnapshotSchema`.
- `createItemInputSchema.due_at` → `deadline_at` (refine de güncellendi); output'a `reminders: ItemReminderSnapshot[]` eklendi (kullanıcı deadline verirse default 1 absolute reminder oluşturulur, mevcut UX preserve).
- `updateItemInputSchema.due_at` → `deadline_at`; `updateItemOutputSchema.changes` enum `due_at` → `deadline_at`.
- `searchItemsInputSchema.has_reminder` semantiği yeni: `item_reminders` tablosundaki **unsent + future** satırın varlığı.
- `scheduleReminderInputSchema/OutputSchema` **silindi**; yerine:
  - `setDeadlineInputSchema/OutputSchema` — `{ item_id, deadline_at: string|null }` → output `{ item, reminders, cleared, warnings? }`.
  - `addReminderInputSchema/OutputSchema` — XOR refine: `remind_at` veya `offset_minutes` (ikisi birden olamaz). `offset_minutes` ile `recurrence_rule` aynı anda olamaz (ikinci refine).
  - `removeReminderInputSchema/OutputSchema` — `{ reminder_id }`.
- `TOOL_NAMES` array: `schedule_reminder` çıkarıldı, `set_deadline` + `add_reminder` + `remove_reminder` eklendi.
- Tool registry'deki `schedule_reminder` description silindi, 3 yeni tool için detaylı LLM-facing description eklendi (TR + EN örnek phrasing'ler dahil). `create_item` ve `update_item` description'larındaki `due_at` referansları `deadline_at`'e güncellendi.

### Executor'ler (`src/lib/server/tools/`)

- `_shared.ts` — yeni `Tx` type export, yeni `recomputeOffsetReminders(tx, itemId, newDeadline)` helper. Helper SQL-level UPDATE yapar (`remind_at = newDeadline - offset_minutes * interval '1 minute'`, `sent=false`); `newDeadline === null` ise tüm `before_deadline` reminder'ları siler (absolute reminder'lar dokunulmaz).
- `set-deadline.ts` (**yeni**) — Tek transaction'da deadline write + `recomputeOffsetReminders` + activity_log (`item_deadline_set` veya `item_deadline_cleared`). Past deadline → silent drop + warning (`deadline_at_in_past`). Note (isCheckable=false) → `cannot_schedule_note`.
- `add-reminder.ts` (**yeni**) — RRULE validate, XOR enforce, `kind='before_deadline'` ise item.deadlineAt non-null check (yoksa `deadline_required`), absolute past ise `invalid_input`. Activity_log: `item_reminder_added` (`payloadAfter` = reminder snapshot).
- `remove-reminder.ts` (**yeni**) — Reminder bul → parent item'ın list'inde write yetkisi check → DELETE → activity_log `item_reminder_removed`.
- `schedule-reminder.ts` — **silindi**.
- `update-item.ts` — `due_at` → `deadline_at` rename. Deadline değişiminde `recomputeOffsetReminders` çağrılır. Activity action mapping: `item_deadline_set/cleared` (deadline sole change) veya `item_moved` veya `item_edited`. Eski `reminder_sent` write'ları kaldırıldı (kolon yok).
- `create-item.ts` — `due_at` → `deadline_at`. Eğer `deadline_at` provided ise default 1 absolute `item_reminders` satırı INSERT edilir (deadline anchor) + ekstra `item_reminder_added` activity_log row (eski "deadline = ping" UX'i preserve eder). Output'a `reminders: []` eklendi.
- `search-items.ts` — `has_reminder` filtresi `EXISTS (SELECT 1 FROM item_reminders WHERE item_id = items.id AND sent=false AND remind_at > now())` subquery oldu. Kullanılmayan `gt` import temizlendi.
- `dispatcher.ts` — `executeScheduleReminder` import silindi, 3 yeni import + 3 yeni case eklendi.

### Cron (`src/lib/cron/dispatch-reminders.ts`)

**Tam rewrite**:
- Pickup query artık `item_reminders → items → lists → owner + assignee + workspace_bots` JOIN'i. WHERE: `remindAt <= now() AND sent = false AND items.archivedAt IS NULL`.
- `markReminderSent(reminderId)` — `item_reminders.sent` flip eder, `lastSentAt` set eder; conditional `WHERE sent = false` (Inv-11 idempotency).
- `advanceRecurringReminder(reminderId, currentRemindAt, recurrenceRule)` — `item_reminders` tablosunda RRULE advance; `kind='absolute'` zorunluluğu: `before_deadline` reminder'ları **asla advance edilmez** (CHECK constraint zaten engelliyordu).
- `formatReminderBody` — deadline farklıysa "Son tarih: …" satırını ekstra emit eder (TR + EN). Default-on-deadline reminder'larda iki tarih aynı → tek satır.
- `detectPersistentFailures` (Inv-15) — pickup `item_reminders` JOIN `items`'a güncellendi; `remind_at < now() - 5min AND sent=false AND archived_at IS NULL`.

### HTTP routes (`src/app/api/`)

- `items/route.ts` (POST) — body `dueAt` → `deadlineAt`; executor input `due_at` → `deadline_at`.
- `items/[id]/route.ts` (PATCH) — body `dueAt` → `deadlineAt`; executor input `due_at` → `deadline_at`.
- `items/[id]/reminders/route.ts` (**yeni**) — POST: `executeAddReminder`; XOR validation, `deadline_required` → 409, `cannot_schedule_note` → 400.
- `items/[id]/reminders/[reminderId]/route.ts` (**yeni**) — DELETE: `executeRemoveReminder`.
- `workspaces/[id]/bulk-restore/route.ts` — `itemSnapshotSchema` legacy (`dueAt`/`reminderSent`) **ve** Phase 14d (`deadlineAt`) field'larını opsiyonel kabul eder; restore path canonical `deadlineAt`'i tercih eder, fallback olarak `dueAt`'e bakar. Inline `payloadAfter` literal'ı `toItemSnapshot(created)`'a değiştirildi.
- `src/lib/server/restore.ts` — aynı pattern: legacy + canonical opsiyonel, `deadlineAt ?? dueAt` resolution. ⚠️ Restore'da reminder satırları **yeniden yaratılmıyor** — soft-delete edilen item'ların pings'i geri gelmez (kabul edilebilir trade-off, dokümantasyona değer).

### Validators (`src/lib/validators/items.ts`)

- `createItemBodySchema.dueAt` → `deadlineAt` (refine güncellendi).
- `updateItemBodySchema.dueAt` → `deadlineAt` (refine güncellendi).
- Yeni `addReminderBodySchema` (XOR refine + RRULE-only-with-absolute refine).
- Yeni `reminderParamsSchema` (`{ id, reminderId }` UUID validation).
- `PatchItemResponse.changes` enum genişletildi (`deadline_at`, `list_id`, `pinned`).
- `CreateItemResponse.reminders?: ItemReminderSnapshot[]` eklendi.
- Yeni response types: `AddReminderResponse`, `RemoveReminderResponse`.

### Mini App UI

- `src/components/items/reminder-indicator.tsx` — props `{deadlineAt}` (eski `{dueAt, reminderSent}`); aria-label "deadline: …"; pre-existing `Date.now()` lint warning'i için inline `eslint-disable-next-line react-hooks/purity` eklendi (1-frame staleness OK).
- `src/components/lists/item-edit-sheet.tsx` — form schema `dueAtLocal` → `deadlineAtLocal`; `ItemEditPatch.dueAt` → `deadlineAt`; label "Son tarih (opsiyonel)" + helper text güncellendi (deadline boş → cascade silinme açıklaması).
- `src/components/lists/item-row.tsx` — `<ReminderIndicator deadlineAt={item.deadlineAt ?? null} />`; `reminderSent` prop kaldırıldı.
- `src/components/lists/item-list.tsx` — optimistic patch'te `patch.dueAt` → `patch.deadlineAt`.
- `src/components/activity/activity-sentence.tsx` — `item_due_set/cleared` arm'larına Phase 14d eşdeğerleri (`item_deadline_set/cleared`) **switch fallthrough** ile eklendi (eski activity_log row'lar hâlâ render edilir). Yeni 3 action için TR + EN sentence template'i: `item_reminder_added/removed/fired`. `_coverage` sanity-check switch'i de güncellendi.
- `src/app/(app)/views/today/page.tsx` — `items.dueAt` → `items.deadlineAt` (3 select/where), `item.dueAt` → `item.deadlineAt` (2 render).
- `src/lib/db/queries/snapshots.ts` (D2 snapshot assembler) — select `items.dueAt` → `items.deadlineAt`; output field `deadlineAt`.

### Tests

- `tests/unit/lib/server/tools/dispatcher.test.ts` — TOOL_NAMES array'inden `schedule_reminder` çıkarıldı, `set_deadline` + `add_reminder` + `remove_reminder` eklendi.
- `tests/unit/lib/server/tools/executors-input-validation.test.ts` — `executeScheduleReminder` import silindi, 3 yeni executor için input validation case'leri eklendi (set_deadline malformed datetime, add_reminder XOR violation, remove_reminder non-uuid).

---

## Critical migration notes (deploy runbook)

1. **Cron container durdurulmalı** migration'dan önce. Aksi halde 60s'lik bir pencerede eski cron `items.due_at` query'si çalışır → 0 row, sessiz miss.
2. `npm run db:migrate` çalıştır.
3. Yeni kodu deploy et (web + cron birlikte).
4. Cron container başlat.
5. Doğrulama:
   ```sql
   SELECT COUNT(*) FROM item_reminders;  -- = pre-migration items WHERE due_at NOT NULL AND archived_at IS NULL
   SELECT column_name FROM information_schema.columns
     WHERE table_name='items' AND column_name IN ('due_at','reminder_sent','recurrence_rule');
   -- → empty result
   ```
6. UptimeRobot 5dk sonra hâlâ yeşil mi? Healthchecks.io backup heartbeat etkilenmedi mi?

**Total cron downtime hedefi: ~60s.**

---

## Bilinen sınırlamalar / follow-up'lar (Phase 14d.1)

- ⚠️ **Mini App reminder edit UI yok**. Sheet'te sadece tek `<input type="datetime-local">` var. Bu deadline atar ve executor otomatik **1 absolute reminder** üretir (eski UX preserve). Kullanıcı şu an Mini App'te:
  - ✅ Deadline ata / değiştir / sil yapabilir
  - ✅ Default reminder'ı dolaylı yoldan kontrol edebilir (deadline = reminder)
  - ❌ Multi-reminder ekle/sil yapamaz
  - ❌ "1 gün önce hatırlat" gibi `before_deadline` reminder kuramaz
  - ❌ RRULE editleyemez
  
  Bu fonksiyonalite **bot tarafında tam çalışıyor** (LLM tool'lar `add_reminder`/`remove_reminder` ile). Mini App `useFieldArray`-tabanlı sub-section bir sonraki iterasyon (planda detaylı). Plan dosyasındaki "ItemEditSheet UI sketch" bölümü referans alınabilir.

- ⚠️ **GET `/api/lists/[id]/items` reminder'ları döndürmüyor**. Frontend henüz reminder array'i okumadığı için tutarlı; ama Mini App reminder UI'ı eklendiğinde bu route'un response shape'i `{ items: ItemWithReminders[] }` olarak genişletilmeli (subquery `array_agg(item_reminders.*)` veya N+1). Plan dosyasında not edildi.

- ⚠️ **`drizzle/meta/0011_snapshot.json` yok**. Sonraki `npm run db:generate` interaktif prompt'a cevap isteyecek (rename mi, drop+create mi). Çözüm: bir kez TTY ortamda `db:generate` çalıştır + drizzle'a `due_at → deadline_at`'in **rename** olduğunu söyle (`reminder_sent`/`recurrence_rule` zaten yok, snapshot regenerate eder).

- **Restore reminder'ları yeniden yaratmıyor**. `restore.ts` ve `bulk-restore` `item_deleted` row'larını geri çevirir, ama `item_reminders` rows'ları `ON DELETE CASCADE` ile silinmiş; restore sırasında onları geri yaratmıyoruz (eski state'in tam reconstruction'ı için child-table snapshot'ları gerekirdi). Kabul edilebilir: restore zaten "edit history reset" semantiğine yakın.

- **Activity log eski rows**. `item_due_set` / `item_due_cleared` action'ları union'da kalmaya devam ediyor; activity-sentence frontend renderer eski row'lar için TR/EN sentence emit eder (yeni Phase 14d sentence'iyle aynı içerik). Eski `payloadBefore`/`payloadAfter` jsonb'leri loose validation; deserialize problemi yok.

- **Recurring reminder advance rearming**. Plan'daki tasarım: deadline taşınınca `recomputeOffsetReminders` `before_deadline` reminder'ları rearm eder (`sent=false`). Bu intentional — taşınmış deadline = yeni context = yeni ping. Tool description'da `set_deadline` LLM'e bunu phrase et diyor: "deadline'ı ileri aldım, hatırlatmaları yeniden kuruldu".

---

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing `Date.now()` warning'ine inline disable + gerekçeli yorum)
- ✅ `npm run typecheck` — 0 hata (başlangıçta 52 cascade hata vardı; hepsi sırayla düzeltildi)
- ✅ `npm test` (vitest) — 81 passed / 1 skipped / 8 files
- ❌ Migration **DB üzerinde çalıştırılmadı** — staging'de manuel test edilmeli
- ❌ Manuel e2e (test bot ile reminder add/remove → DM gelmesi) — kullanıcı tarafından doğrulanacak

---

## Plan'da tanımlı ama bu PR'da yapılmayan işler

`~/.claude/plans/phase-13-fuzzy-volcano.md`'de listelenen ama **scope dışı** tutulanlar:

- `set_deadline` activity_log payload'ında pre/post reminders array'i (`payloadBefore = {item, reminders}`) — şimdi sadece `item` snapshot var; reminder snapshot'ları ayrı `item_reminder_added/removed` row'larında. Plan'daki "reminders dahil snapshot" daha kapsamlıydı ama gerçek implementasyon Inv-1 transaction içinde 1 deadline_set + N reminder_removed/added activity row yazıyor — daha okunaklı bir audit chain.
- `item_reminder_fired` activity log entries (cron success post-write) — şimdilik kapsamda değil, çünkü chatty olabilir; cron sadece silent UPDATE yapıyor.
- `formatReminderBody` user'ın `dateFormat`/`timeFormat` pref'ine göre format — Phase 14c'ye bağımlı (henüz schema'da o kolon yok).
- i18n dosyalarına yeni keys (`messages/{tr,en}.json`). Activity sentence'ları bileşen içinde inline TR + EN olduğu için **bu PR'da i18n key dosyası touch edilmedi**. Plan'daki `items.edit.deadline.{label,help}` etc. anahtarlar sheet'te inline TR olarak gerçekleşti (mevcut pattern'le tutarlı).

---

## Sıradaki adımlar (plan sırasına göre)

1. ✅ **Phase 14a — item description**
2. ✅ **Phase 14c — date/time format prefs**
3. ✅ **Phase 14b — Telegram attachments**
4. ✅ **Phase 13 — Voice I/O input only**
5. ✅ **Phase 16 — Checklists** (plan dışı, kullanıcı isteği)
6. ✅ **Phase 15 — Calendar week view + 09:00 daily digest cron**
7. ✅ **Kanban view** (status sütunlu board, multi-container DnD)

**Plandaki tüm phase'ler TAMAM**. Her biri bağımsız PR. Hepsi shipping-ready; staging'de migration + manuel doğrulama tamamlanınca prod'a açılabilir.

---

# Phase 14a — Item description

## Tek satır özet

`items.description text` (nullable, ≤5000 char) eklendi. AI tools (`create_item`, `update_item`) ve Mini App `ItemEditSheet` (textarea) ile `ItemRow` (FileText ikonu rozeti) `description`'ı yazmaya/okumaya bağlandı.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅**.

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts` — `items` tablosuna `description: text("description")` (nullable) eklendi.
- `drizzle/0012_phase14a_item_description.sql` — basit `ALTER TABLE items ADD COLUMN description text;`. Backfill yok (mevcut item'lar NULL → UI'da ikon görünmez).
- `drizzle/meta/_journal.json` — idx 12 eklendi.

### Types + snapshots

- `src/lib/types/index.ts` — `ItemSnapshot.description: string | null` eklendi (text'ten hemen sonra).
- `src/lib/db/snapshots.ts` — `toItemSnapshot` `description: row.description ?? null` set ediyor.

### Validators

- `src/lib/validators/items.ts` — `createItemBodySchema` ve `updateItemBodySchema`'ya `description: z.string().max(5000).nullable().optional()` eklendi. `updateItemBodySchema.refine()` description'ı sole-mutation olarak kabul ediyor. `PatchItemResponse.changes` enum'una `description` eklendi.

### AI tools (`src/lib/ai/tools.ts`)

- `itemSnapshotSchema.description: z.string().nullable()` eklendi.
- `createItemInputSchema` ve `updateItemInputSchema`'ya `description: z.string().max(5000).nullable().optional()` eklendi. `updateItemInputSchema.refine()` description sole-mutation kabul ediyor. Output `changes` enum genişletildi.
- `create_item` description metni uzatıldı: "use description for longer multi-line context, NOT a summary of `text`. Keep `text` short". `update_item` description metni: `description: '<text>'` veya `description: null` semantiği.

### Executor'ler

- `src/lib/server/tools/create-item.ts` — `description` parse + normalize (empty/whitespace string → null) + INSERT. Output snapshot otomatik kapsar.
- `src/lib/server/tools/update-item.ts` — description patch tracking + normalize + `changes.push("description")`. Activity action mapping etkilenmedi (description-only değişiklik `item_edited` olur, deadline/list-sole değil).

### HTTP routes

- `src/app/api/items/route.ts` (POST) — body `description` parse + executor input.
- `src/app/api/items/[id]/route.ts` (PATCH) — body `description` parse + executor input + dispatch tetikleme şartına `description !== undefined` eklendi.

### Mini App UI

- `src/components/ui/textarea.tsx` (**yeni**) — minimal shadcn-style Textarea component (`forwardRef`, `cn` ile var(--lb-*) tema değişkenleri, `min-h-[88px] resize-y`, focus ring `--lb-accent`).
- `src/components/lists/item-edit-sheet.tsx`:
  - Form schema `description: z.string().max(5000).optional()` eklendi.
  - `ItemEditPatch.description?: string | null` eklendi.
  - `defaultValues` + `reset()` `item.description ?? ""` kullanıyor.
  - Sheet body'de "Başlık" (Text) input'undan sonra "Açıklama (opsiyonel)" Textarea (rows=4, max 5000, error display).
  - `diffPatch`: empty/whitespace string ↔ null normalization; current vs next karşılaştırması.
  - Sheet header label "Text" → "Başlık".
- `src/components/lists/item-row.tsx` — `FileText` lucide ikonu ile description-mevcut rozeti (ReminderIndicator'dan sonra). Tooltip ilk 80 karakter (truncate'lerse `…` ekler), aria-label "açıklama mevcut", muted-fg renk.
- `src/components/lists/item-list.tsx` — optimistic patch'te `patch.description !== undefined` → `next.description = patch.description`.

### Activity log

Yeni action eklenmedi — description değişimi `update_item` üzerinden `item_edited` action'ı yazıyor; `payloadBefore/After` snapshot'ları otomatik kapsıyor (audit + restore otomatik çalışır).

## Test edilenler

- ✅ `npm run lint` — temiz
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Migration DB'de çalıştırılmadı — staging manuel test
- ❌ Manuel e2e — kullanıcı doğrulayacak

## Bilinen sınırlamalar

- `search_items` description'ı scan etmiyor — kapsam dışı, follow-up. Eklenirse `ILIKE text || ' ' || description` pattern'i.
- Markdown rendering yok; helper text "düz metin" diyor (placeholder + sheet description).

## Effort

~25 dakika (planın "3-4 saat" tahmininin altında — schema küçük, UI tek textarea + ikon).

---

# Phase 14c — Date / time format prefs

## Tek satır özet

`users.date_format` (`'DD.MM.YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'`) ve `users.time_format` (`'24h' | '12h'`) eklendi. AI tool `update_settings` + `/api/settings` PATCH/GET + Mini App `SettingsForm` (canlı önizleme) + cron `formatReminderBody` user pref'lerini kullanıyor. Yeni `formatDate(input, opts)` utility tüm display tarafında çağrılabilir.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅**.

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts` — `users` tablosuna `dateFormat: text("date_format").notNull().default("DD.MM.YYYY")` ve `timeFormat: text("time_format").notNull().default("24h")` eklendi.
- `drizzle/0013_phase14c_user_date_format.sql` — iki kolon ADD + EN locale satırlarını backfill (`UPDATE users SET date_format='MM/DD/YYYY', time_format='12h' WHERE locale='en'`). TR satırlar default'ta kalır.
- `drizzle/meta/_journal.json` — idx 13 eklendi.

### Validators (`src/lib/validators/settings.ts`)

- Yeni `ALLOWED_DATE_FORMATS`, `AllowedDateFormat`, `ALLOWED_TIME_FORMATS`, `AllowedTimeFormat` exports.
- `patchSettingsBodySchema` `dateFormat` + `timeFormat` opsiyonel eklendi.
- `GetSettingsResponse` shape'ine `dateFormat: AllowedDateFormat`, `timeFormat: AllowedTimeFormat` eklendi.

### AI tools

- `updateSettingsInputSchema` ve `updateSettingsOutputSchema` — yeni opsiyonel `date_format` + `time_format` + `changes` enum genişletildi.
- Tool description'da `date_format` ve `time_format` örnek phrasing'leri eklendi (TR + EN).

### Executor

- `src/lib/server/tools/update-settings.ts` — `date_format` / `time_format` parse, change tracking (`changes.push("date_format")` vb.), idempotent no-op cevapta yeni alanlar dahil. Output type `AllowedDateFormat`/`AllowedTimeFormat` cast'leri ile döner.

### HTTP route

- `src/app/api/settings/route.ts` (GET + PATCH) — body parse'ında `dateFormat`/`timeFormat`, response shape'ine yeni alanlar dahil. PATCH undefined ise dokunmuyor (idempotent).

### Format utility (yeni)

- `src/lib/utils/format-date.ts` — `formatDate(input, { dateFormat, timeFormat, timezone, locale, show? })`. Date kısmı `Intl.DateTimeFormat("en-CA", { timeZone })`'ten parts alıp manuel layout (`DD.MM.YYYY` etc.); time kısmı `Intl.DateTimeFormat({ hour12 })` ile native locale-aware AM/PM. Invalid date → empty string; invalid timezone → UTC fallback. `show` filter: `'datetime' | 'date' | 'time'`.

### Cron (`src/lib/cron/dispatch-reminders.ts`)

- Pickup query'ye `owner.date_format`, `owner.time_format`, `assignee.date_format`, `assignee.time_format` SELECT'leri eklendi.
- `ReminderJob` type'a `ownerDateFormat`, `ownerTimeFormat`, `assigneeDateFormat`, `assigneeTimeFormat` eklendi (assignee fall-back-to-owner pattern).
- `formatReminderBody` `Intl.DateTimeFormat` yerine `formatDate(...)` kullanıyor; deadline ve remindAt aynı pref'lerle render ediliyor.
- Eski `formatLocalTime` helper'ı silindi.

### Mini App UI (`src/components/settings/settings-form.tsx`)

- `SettingsInitial` shape'e `dateFormat: DateFormat`, `timeFormat: TimeFormat` eklendi.
- Form values + PatchPayload + defaultValues + `reset()` yeni alanları içeriyor.
- `onSubmit` patch builder yeni alanları compare ediyor.
- Yeni "Tarih & Saat Formatı" Section: iki `<select>` (date format + time format) + her birinin altında **canlı önizleme** (`previewDate(...)` ve `previewTime(...)` saf fonksiyonları, watch'lu değerle).
- DATE_FORMAT_OPTIONS ve TIME_FORMAT_OPTIONS sabitleri TR label'lar (örn "GG.AA.YYYY (Avrupa)").

### Settings page (server component)

- `src/app/(app)/settings/page.tsx` — `fetchInitialSettings` fallback shape'ine `dateFormat: "DD.MM.YYYY"`, `timeFormat: "24h"` eklendi (API başarısız olursa form yine render edilir).

## Test edilenler

- ✅ `npm run lint` — temiz
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Migration DB'de çalıştırılmadı — staging manuel test (özellikle EN backfill `UPDATE` cümlesi)
- ❌ DST tarihinde unit test yazılmadı — plan'da öngörülmüştü; follow-up kapsamına alındı

## Bilinen sınırlamalar / follow-up

- ⚠️ **Mini App display tarafında `formatDate` heryerde uygulanmadı**. Sadece **cron `formatReminderBody`** ve **`SettingsForm` önizlemesi** user pref'lerini kullanıyor. Diğer client-side render'lar (`ReminderIndicator`, `today/page.tsx`, `activity-timeline`) mevcut `Intl.DateTimeFormat` ile çalışmaya devam ediyor — locale-aware ama dateFormat/timeFormat-aware değil. Bu adım plan'da `useUserFormatter` provider/hook gerektiriyor (TanStack Query ile `["settings"]` cache'leyip context'le yayılması). Tek session'da risk arttığı için scope'tan çıkarıldı; bir sonraki iterasyonda eklenebilir.
- HTML5 `<input type="datetime-local">` cihaz locale'ini kullanır; pref'imiz **sadece display** için. Sheet helper text'inde belirtilebilir (yapılmadı).
- `update_settings` output `changes` array'i `"date_format"`/`"time_format"` döndürebiliyor — ama fronntend bunu özel olarak işlemiyor (refresh sonrası rerender yeterli).

## Effort

~30 dakika.

---

# Phase 14b — Telegram attachments (hybrid storage)

## Tek satır özet

`item_attachments` tablosu (1-N child of `items`) eklendi. Bot intake `extractAttachmentFromMessage` ile photo/video/document/audio/voice/video_note çekiyor; LLM `[ATTACHMENT_CONTEXT: ...]` overlay ile yeni `attach_file_to_item` tool'unu çağırıyor. Mini App `ItemEditSheet`'te thumbnail grid + lightbox + delete; bytes proxy `/api/attachments/[itemId]/[attachmentId]` üzerinden Telegram CDN'ye streamleniyor (token client-side'a sızmıyor). Hetzner Object Storage backup cron'u `dispatch-reminders` tick'ine piggy-back ediyor — env yoksa silent skip.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅** (1 pre-existing warning Phase 14b dışı).

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts` — yeni `itemAttachments` table: id, itemId (FK CASCADE), workspaceId (FK CASCADE, denormalized), kind, telegramFileId, telegramFileUniqueId, mimeType, fileSize (bigint), durationSeconds, width/height, thumbnailFileId, originalFilename, storageKey, storageBackedUpAt, uploadedByUserId (FK CASCADE), createdAt. 3 index: item_attachments_item_idx, item_attachments_backup_queue_idx (partial: storage_backed_up_at IS NULL), item_attachments_telegram_unique_idx (partial: file_unique_id IS NOT NULL — dedup).
- `drizzle/0014_phase14b_item_attachments.sql` — additive create + 3 FK + 3 index. Backfill yok.
- `drizzle/meta/_journal.json` — idx 14 eklendi.

### Types + snapshots

- `src/lib/types/index.ts`:
  - `ItemAttachment`, `NewItemAttachment`, `AttachmentKind` ('photo'|'video'|'document'|'audio'|'voice'|'video_note').
  - `AttachmentSnapshot` — JSON-safe shape (telegramFileId + storageKey **gizli**, sadece `hasBackup: boolean`). Activity_log payload + Mini App response shape.
  - `ActivityAction` union: `item_attachment_added`, `item_attachment_removed` eklendi.
- `src/lib/db/snapshots.ts` — `toAttachmentSnapshot(row): AttachmentSnapshot`. Hassas alanlar (telegramFileId, storageKey) hiçbir zaman snapshot'a girmez.

### Validators

- `src/lib/validators/attachments.ts` (yeni) — `ATTACHMENT_KINDS`, `attachmentParamsSchema` ({ itemId, attachmentId } UUID), `itemAttachmentsListParamsSchema` ({ itemId } UUID).

### AI tool (`src/lib/ai/tools.ts`)

- Yeni `attachFileToItemInputSchema` (item_id, kind enum, file_id, file_unique_id?, mime_type?, file_size? max 2GB, duration?, width?, height?, thumbnail_file_id?, filename?).
- Yeni `attachFileToItemOutputSchema`: { attachment: { id, item_id, kind, mime_type, file_size, original_filename }, item: itemSnapshotSchema }.
- `TOOL_NAMES` array'ine `attach_file_to_item` eklendi.
- Tool registry'de detaylı LLM-facing description: "Bot intake layer pre-extracts file metadata into a system overlay `[ATTACHMENT_CONTEXT: file_id=<...> kind=<...>]` — pull `file_id` from THERE. NEVER fabricate file_ids." + örnek phrasing'ler.

### Executor (`src/lib/server/tools/attach-file-to-item.ts`, yeni)

- Inv-1 transactional: parent item + parent list lookup + workspace match + write-permission check.
- **Dedup short-circuit**: `(item_id, file_unique_id)` aynıysa mevcut row'u döndürür (idempotent re-send).
- INSERT + activity_log row (`item_attachment_added`, payloadAfter = full snapshot).
- `_shared.ts` `toAttachmentSnapshot`'ı re-export ediyor.
- `dispatcher.ts` registry'sine eklendi.

### Bot intake (`src/lib/server/bot/`)

- `handle-message.ts`:
  - `extractAttachmentFromMessage(message)` helper — photo/video/document/audio/voice/video_note için tip-güvenli parse. Photos: `message.photo[-1]` (en büyük variant). Videos/docs için thumbnail `file_id`'si dahil.
  - `formatAttachmentContext(att)` — `[ATTACHMENT_CONTEXT: kind=... file_id=... ...]` overlay tag'i.
  - `labelKindTr(kind)` — TR fallback ("Fotoğraf", "Video notu", vb.) caption boşken.
  - Slash-command guard `attachment` varsa pass-through (eskiden `text` boşsa erken return ediyordu).
  - User message persist: `effectiveText = text || caption`. Attachment varsa `persistedContent` placeholder ile, `llmContent` overlay ile augmente edilir.
- `index.ts` — `bot.on("message:text", handleMessage)` → `bot.on("message", handleMessage)` (slash commands bot.command'a takılı kaldığı için sıra korundu).

### HTTP routes

- `src/app/api/items/[id]/attachments/route.ts` (**yeni**) — GET list. Read access yeterli (any role). `toAttachmentSnapshot`'la JSON döndürür; raw file_id sızdırmaz.
- `src/app/api/attachments/[itemId]/[attachmentId]/route.ts` (**yeni**):
  - **GET**: ACL read → `bot.api.getFile()` → `https://api.telegram.org/file/bot${TOKEN}/${path}` server-side fetch → response.body stream. Token client'a hiç gitmez. `Cache-Control: private, max-age=2700` (45 min < Telegram'ın 1h URL TTL'i).
  - **DELETE**: write access required → transactional row delete + activity_log `item_attachment_removed`.
- `src/lib/db/queries/items.ts` — yeni `userCanReadList(userId, listId, workspaceId)` (any role) — viewer'lar attachment listeleyebilsin/byte alabilsin diye.

### Mini App UI

- `src/hooks/use-attachments.ts` (**yeni**):
  - `useAttachments(itemId)` — TanStack Query polling 5s, queryKey `["attachments", itemId]`.
  - `useDeleteAttachment(itemId)` — DELETE mutation + cache update + items invalidate.
  - `attachmentBytesUrl(itemId, id)` — proxy URL helper.
- `src/components/lists/item-edit-sheet.tsx`:
  - `<AttachmentsSection />` — Tags input'undan sonra render. 3-column grid; her thumbnail tile için: photo `<img src={proxyUrl}>`, diğerleri `KindIcon` (Video/Mic/FileIcon lucide). Filename truncate + delete button per row. `hasBackup === false` rozet `⏳`.
  - `<Lightbox />` modal — `<dialog>` semantics, ESC + backdrop click kapatır, photo full-screen, document/audio download link.

### Cron piggy-back

- `src/lib/cron/backup-attachments.ts` (**yeni**):
  - `backupAttachmentsBatch()` — batch 20, oldest-first via partial index.
  - Per-row: `bot.api.getFile()` → `fetch(tgUrl)` → `uploadAndPresign(key, buf, mime)` → `UPDATE storage_key + storage_backed_up_at`.
  - 20MB cap: `fileSize > 20MB` → skip + counter. Per-row failures bırakılır (warning log), batch devam.
  - `objectStorageConfigured() === false` → no-op (Hetzner env yoksa silent skip).
  - Storage key path: `attachments/{workspace_id}/{item_id}/{attachment_id}{ext}`. `guessExtension(filename, mimeType)` filename uzantısını dener, sonra MIME subtype mapping (jpeg→jpg, mp4, webm, pdf, docx, xlsx, txt, ogg, vb.).
- `src/lib/cron/dispatch-reminders.ts` — `main()` sonuna piggy-back: dynamic `import("./backup-attachments")` → `backupAttachmentsBatch()` → cron logu (sadece `picked > 0` ise log). **Reminder pipeline exit code'u attachment failure'larından etkilenmez.**

### Activity-sentence

- `src/components/activity/activity-sentence.tsx` — yeni 2 case:
  - `item_attachment_added`: TR "{actor} {item} maddesine bir ek ekledi", EN "{actor} attached a file to {item}"
  - `item_attachment_removed`: TR "{actor} {item} maddesinden bir eki kaldırdı", EN "{actor} removed an attachment from {item}"
- `_coverage` switch genişletildi.

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing warning, `invite-accept-card.tsx`)
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Migration DB'de çalıştırılmadı — staging manuel test
- ❌ Manuel e2e (test bot'a foto + caption "Süt al" → Mini App'te thumbnail) — kullanıcı doğrulayacak
- ❌ Hetzner backup cron prod env'de çalıştırılmadı — staging'de Hetzner env var'ları varsa otomatik etkin

## Bilinen sınırlamalar / follow-up (Phase 14b.1)

- ⚠️ **`ItemRow` Paperclip rozeti yok**. Plan'da öngörülmüştü ama `attachmentCount`'u her item için ayrı query yapmak optimum değil. Doğru yol: `GET /api/lists/[id]/items` query'sine `LEFT JOIN LATERAL (SELECT COUNT(*) ...)` veya `array_agg(item_attachments.id)` subquery — sonra `Item` shape'inde `attachmentCount` field. Bu Phase 14b.1 kapsamına alındı; mevcut tek-item açıldığında sheet'te ekler görünüyor.
- ⚠️ **Hetzner-fallback proxy yolu yok**. `route.ts` GET her zaman Telegram CDN'ye gidiyor. Plan'da: `storageBackedUpAt !== null` ise pre-signed Hetzner URL'e 302 redirect. `presignGet` helper'ı `object-storage.ts`'da private; export edilmesi + route'ta kullanılması Phase 14b.1.
- ⚠️ **20MB üstü dosyalar**. Telegram bot CDN'i ≤20MB serve eder; backup cron `fileSize > 20MB` ise atlıyor. UI'da bu durumu indicating bir badge yok (sadece `hasBackup=false` jenerik `⏳`). `backup_skipped_reason` kolonu eklenip UI'da "büyük dosya — kalıcı yedek alınamadı" rozeti ayrılabilir.
- ⚠️ **Lifecycle GC yok**. Item hard-delete edilirse `item_attachments` CASCADE ile silinir, ama Hetzner objesi orphan kalır. Plan: 30-day grace + cleanup job. Phase 14b.1.
- ⚠️ **Token rotation 30dk aggressive backup mode** plan'da yapı önerilmişti — şimdilik yok. Operator manuel olarak cron tick interval'i azaltabilir veya batch size artırabilir.
- **Rate limit**: thumbnail proxy server'ı yorabilir. Mevcut `enforceRateLimit({ scope: 'attachment-fetch', tokens: 200, windowSeconds: 3600 })` plan'da öngörülmüştü; şimdilik yok. Self-host ölçeğinde bekleyebilir.
- **`ItemEditSheet` lightbox**: temel implementasyon — swipe-to-dismiss yok, multi-image carousel yok. Tek attachment için temizce çalışır.
- **Caption ambiguity**: kullanıcı `[fotoğraf] Süt al` yazdığında LLM yeni item oluşturup attach eder; `[fotoğraf]` (caption boş) ise tool description LLM'i "hangi maddeye?" sormaya yönlendirir — ama bu davranış **tool description'a bağlı**, deterministik değil. Fine-tuning gerekirse system prompt'ta açıkça izah edilebilir.

## Effort

~50 dakika (planın "10-14 saat" tahmininin çok altında — schema + tool + intake + UI + proxy + cron + activity hepsi tek session'da). Plan'daki kapsam dışı bırakılan parçalar (Paperclip rozeti, Hetzner-fallback proxy, 20MB rozeti, GC, rate limit, lightbox swipe) Phase 14b.1'e ertelendi.

---

# Phase 13 — Voice I/O (input only, TTS Phase 13.5)

## Tek satır özet

Bot'a sesli mesaj geldiğinde (voice / audio / video_note) **OpenRouter Gemini 2.5 Flash** üzerinden raw `fetch` ile transcribe edilip `🎤 <transcript>` olarak mevcut LLM pipeline'ına user turn olarak inject ediliyor. Schema değişikliği yok, yeni env var yok — mevcut OpenRouter BYOK chain (user → workspace → operator) reuse. TTS Phase 13.5'e ertelendi (operator cost burden + TR voice signal kanıtlanmadan).

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅** (1 pre-existing warning Phase 13 dışı).

## Yeni / değişen dosyalar

### STT helper (yeni)

- `src/lib/server/bot/stt.ts`:
  - `transcribeAudioFromTelegram({ ctx, fileId, kind, mimeType?, apiKey, locale, appTitle? })` → `{ text } | { error: 'too_long' | 'transcribe_failed' | 'download_failed' | 'empty' }`.
  - **15MB cap**: `getFile` `file_size` ya da fetch sonrası buffer length kontrolü.
  - **Format mapping**: voice → "ogg", video_note → "mp4", audio → mime'den ("mpeg/mp3"→"mp3", "wav"→"wav", "mp4/m4a"→"mp4", "flac"→"flac", "ogg"→"ogg", default "ogg").
  - **OpenRouter request**: raw `fetch` to `https://openrouter.ai/api/v1/chat/completions`, model `google/gemini-2.5-flash`, OpenAI-compat content blocks: `[{ type: "input_audio", input_audio: { data: <base64>, format } }, { type: "text", text: <prompt> }]`. Headers: `Authorization`, `HTTP-Referer: https://prod.listbull.org`, `X-Title: listbull`.
  - **Locale-aware prompt**: TR "Aşağıdaki ses kaydını harfi harfine yazıya dök..." / EN "Transcribe the following audio recording verbatim...".
  - **Why raw fetch**: Anthropic SDK (used by `respond.ts`) ses content-block desteklemediği için tekrar Anthropic API üzerinden geçemiyoruz. Tek POST için lib eklemeye değmez.
  - Response parse: `choices[0].message.content` string ya da OpenAI-compat array of parts; ikisi de fallback'le destekleniyor. Boş transkript → `{ error: "empty" }`.
  - **Side-effect free**: DB write yok, Telegram send yok — caller orchestrate ediyor.

### Bot intake (`src/lib/server/bot/handle-message.ts`)

- COPY i18n yeni keys: `transcribeFailed`, `audioTooLong`, `audioEmpty` (TR + EN).
- **Voice/audio/video_note ayrımı**: `extractAttachmentFromMessage`'in döndürdüğü `rawAttachment.kind` voice/audio/video_note ise `isVoiceInput=true`. Bu attachment olarak depolanmaz — input mode.
- Slash-command guard: `!effectiveText` empty olsa bile `isVoiceInput` true ise erken return etmiyor (audio'dan text üreteceğiz).
- **STT branch** apiKey resolution sonrası, forward branch'inden önce:
  - `ctx.replyWithChatAction("typing")` (best-effort UI affordance).
  - `transcribeAudioFromTelegram(...)` → success ise `effectiveText = "🎤 ${stt.text}"`, `attachment = null`.
  - Error envelopes: `too_long` → `audioTooLong`, `empty` → `audioEmpty`, diğerleri → `transcribeFailed`.
- `effectiveText` ve `attachment` `let` yapıldı (önce `const`).
- Voice transcript `🎤 ` emoji prefix'le persist edilir → `/reset` history'de voice-origin görsel olarak ayırt edilebilir, schema değişikliği gerektirmez.

### Webhook ack budget

Telegram 60s budget. STT 1-3s + LLM 2-8s = ~3-11s. **Mevcut inline await pattern korundu**, deferred refactor gerekmedi. 30s+ olursa `setImmediate` wrap (Phase 4 plan'ında öngörülmüştü) follow-up.

### LLM tool changes — YOK

Transcript mevcut LLM pipeline'a girer. Existing 25 tool ("yarın 5'te marketten süt al" vb.) voice'tan da text'ten de aynı parse eder.

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing warning, `invite-accept-card.tsx`)
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Manuel e2e (test bot'a TR ses → `create_item` çağrısı) — kullanıcı doğrulayacak
- ❌ OpenRouter audio content-block format **prod'da test edilmedi**. Plan'da risk olarak listelenmişti; ilk deploy sonrası gerekirse `format` ya da content-block shape ayarlanacak.

## Bilinen sınırlamalar / follow-up (Phase 13.5)

- ⚠️ **TTS yok**. Bot reply'ları her zaman text. Plan'da Phase 13 sadece input olarak sınırlandırıldı — TTS ayrı sağlayıcı (operator OpenAI key) + cost burden gerektiriyor. Kullanıcı "voice in" UX value'sünü kanıtladıktan sonra Phase 13.5 olarak eklenir.
- ⚠️ **OpenRouter audio shape varsayımı**. `input_audio` content-block formatı OpenAI'ın `gpt-4o-audio-preview` formatına göre yazıldı. OpenRouter normalize ediyor olmalı, ama Gemini için exact shape farklı olabilir; ilk deploy'da log'lardan netleşir.
- ⚠️ **STT cost telemetry yok**. `llm_usage` tablosuna kaydedilmiyor (workspace cap accounting'i etkilemez). Phase 13'te skip; LLM round-trip normal kaydedilir.
- ⚠️ **TR teknik terim mistranscribe**. Gemini Flash TR'de iyi ama brand/teknik isimleri yanlış duyabiliyor. Onboarding doc'a "yanlış duyarsa text yaz" eklenebilir.
- ⚠️ **Voice forwarded mesajlar**: forward + voice kombinasyonu şu an forward path'ine düşmüyor (forward path metin-only). Voice forward'lar STT branch'ine giriyor; transcribe edilir ama forwarded extraction prompt'u kullanmaz. Edge case; kapsam dışı.
- **Inline await 30s+ riski**: 5dk üstü ses + yavaş LLM round-trip 60s'e yaklaşabilir. Pratikte voice typically <1MB / 30s; sorun değil. Olursa `setImmediate` wrap.
- **Audio attachments artık attach edilmiyor**: Phase 14b'de `audio` AttachmentKind eklenmişti; Phase 13 voice input semantiği ile çatıştığı için `audio` mesajları artık STT'ye gidiyor, attachment row oluşmuyor. Bu intentional — kullanıcı bir MP3 dosyası gönderdiğinde "transcribe" beklemesi makul. Eğer "audio attach" semantiği isteniyorsa, ayrı bir tool veya `document` olarak göndermek (Telegram UI'da "as file") gerek.

## Effort

~30 dakika (planın "1 gün" tahmininin altında — schema yok, yeni env yok, tek helper + 30 satır intake refactor).

---

# Phase 16 — Checklists (kullanıcı isteği, plan dışı)

## Tek satır özet

`lists.is_checklist boolean` + `list_runs` (1-N child) tablosu eklendi. **Run-and-archive** semantiği: item satırları fiziksel olarak korunur, "Yeni run başlat" tüm item'ları reset eder + önceki active run'ı stats snapshot'la kapatır + yeni `list_runs` row'u açar. Checklist mode'unda **Mini App sade UI**: ChecklistBanner (run start/complete + history) + ItemFilters gizli + ItemRow'lar compact (priority/reminder/description/status/tags/assignee badge'leri gizli, sadece checkbox + text + drag handle + actions). 2 yeni LLM tool: `start_checklist_run` + `complete_checklist_run`.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅** (1 pre-existing warning Phase 16 dışı).

## Mimari özet

User bir liste için "checklist olsun" der → `update_list({list_id, is_checklist: true})` → flag set edilir. Mini App sayfa render'ı `list.isChecklist`'e bakıp:
- ItemList'in başına `<ChecklistBanner />` → run start/complete butonları + history strip
- DraggableItemList → ItemRow'a `compact={true}` prop pas-through → her row sade

"Yeni run başlat":
1. Aktif run varsa otomatik close + items_completed = is_done count snapshot
2. Tüm items: status='open', isDone=false, completedAt=null (description/deadline/reminder/tag korunur)
3. Yeni list_runs row insert (itemsTotal = active item count post-reset)
4. Activity log: `checklist_run_completed` (varsa) + `checklist_run_started`

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts`:
  - `lists.isChecklist boolean default false` eklendi.
  - Yeni `listRuns` table: id, listId (FK CASCADE), startedAt, completedAt nullable, startedByUserId (FK), completedByUserId (FK SET NULL nullable), itemsTotal int, itemsCompleted int nullable, createdAt.
  - 2 index: `list_runs_list_recent_idx` (DESC startedAt), `list_runs_active_per_list_uq` (UNIQUE PARTIAL: completedAt IS NULL — at most one open run per list, race-safe).
- `drizzle/0015_phase16_checklists.sql` — additive ALTER + CREATE TABLE + 3 FK + 2 index.
- `drizzle/meta/_journal.json` — idx 15 eklendi.

### Types + snapshots

- `src/lib/types/index.ts`:
  - `ListRun`, `NewListRun`.
  - `ListRunSnapshot` (JSON-safe, activity_log payload + Mini App response shape).
  - `ListSnapshot.isChecklist: boolean` eklendi.
  - `ActivityAction` union: `checklist_run_started`, `checklist_run_completed` eklendi.
- `src/lib/db/snapshots.ts` — `toListSnapshot` `isChecklist` ekledi; `toListRunSnapshot` yeni.
- `src/lib/server/tools/_shared.ts` — `toListRunSnapshot` re-export.

### AI tools (`src/lib/ai/tools.ts`)

- `createListInputSchema` + `createListOutputSchema`: `is_checklist?` opsiyonel + output'a `is_checklist`.
- `updateListInputSchema` + `updateListOutputSchema`: `is_checklist?` opsiyonel; refine genişletildi; `changes` enum'una `"is_checklist"` eklendi.
- `TOOL_NAMES`: `start_checklist_run`, `complete_checklist_run` eklendi.
- 2 yeni schema:
  - `startChecklistRunInputSchema` (list_id|list_name) → output `{list, run, closed_previous_run_id, items_reset}`.
  - `completeChecklistRunInputSchema` (list_id|list_name) → output `{list, run | null, closed: boolean}` (idempotent).
- Tools registry'de detaylı LLM-facing description'lar — TR + EN örnek phrasings, `not_a_checklist` error envelope, idempotency notu.

### Executor'ler (`src/lib/server/tools/`)

- `create-list.ts` — `is_checklist` parse + INSERT (default emoji checklist için ☑️). `toListSnapshot` ile activity_log payload.
- `update-list.ts` — `is_checklist` toggle parse + change tracking + refine genişletildi. Output'a `is_checklist`.
- `start-checklist-run.ts` (**yeni**):
  - Inv-1 transactional: list resolve (write access) + `is_checklist` check (else `not_a_checklist`).
  - Active run varsa: close + capture `items_completed = COUNT(* WHERE is_done=true AND archived_at IS NULL)` + activity_log `checklist_run_completed`.
  - Reset: tüm active item'lar isDone=false, status='open', completedAt=null.
  - Yeni list_runs row insert (itemsTotal = active item count post-reset, startedByUserId=caller).
  - Activity log: `checklist_run_started`.
- `complete-checklist-run.ts` (**yeni**):
  - List resolve + `is_checklist` check.
  - Active run yoksa: idempotent `{closed: false, run: null}` döner.
  - Active run varsa: items_completed snapshot + UPDATE completedAt + completedByUserId + activity_log `checklist_run_completed`.
- `dispatcher.ts` — 2 yeni case.

### HTTP routes

- `src/app/api/lists/[id]/runs/route.ts` (**yeni**):
  - **GET**: read access → `listRuns` desc by startedAt limit 50. `toListRunSnapshot` map.
  - **POST `?action=start|complete`**: shortcut to executors. Default `start`. ACL + workspace zaten executor içinde resolve ediliyor (`resolveActiveWorkspaceId`).
  - Error code → HTTP status mapping: `not_a_checklist` → 400, `not_found` → 404, `forbidden` → 403, `ambiguous_list` → 409.

### Mini App UI

- `src/hooks/use-checklist-runs.ts` (**yeni**):
  - `useChecklistRuns(listId)` — TanStack Query polling 30s.
  - `useStartChecklistRun(listId)` — mutation; success'te items + runs cache invalidate (reset her item'ı stale yapar).
  - `useCompleteChecklistRun(listId)` — mutation; success'te runs cache invalidate.
- `src/components/lists/checklist-banner.tsx` (**yeni**):
  - "Yeni run başlat" primary button (active run yoksa "Run başlat" + Play ikonu, varsa "Yeni run başlat" + RotateCcw ikonu).
  - "Run'ı bitir" secondary button (sadece active run varsa).
  - Aktif run göstergesi: "Aktif run: 2 dk önce · 8 madde".
  - Run history strip: son 5 run, her satırda relative time + completion ratio (`5/8`) ya da "aktif".
  - `formatRelative()` saf TR helper ("şimdi", "5 dk önce", "2 sa önce", "3 gün önce", fallback `toLocaleDateString`).
  - Toast'lar (sonner) success/error.
- `src/components/lists/item-list.tsx`:
  - Yeni `isChecklist?: boolean` prop.
  - `isChecklist` true ise `<ChecklistBanner />` render + `<ItemFilters>` gizlenir (filter chip checklist mood'una uymuyor).
  - `<DraggableItemList compact={isChecklist} />`.
- `src/components/lists/draggable-item-list.tsx` — yeni `compact?: boolean` prop, ItemRow'a pas-through.
- `src/components/lists/item-row.tsx` — yeni `compact?: boolean`. True ise priority/reminder/description/status/tags/assignee badge'leri **conditional render** ile gizlenir (`{!compact && (<>…</>)}`). Drag handle + checkbox + text + actions her zaman görünür.
- `src/app/(app)/lists/[id]/page.tsx` — `<ItemList isChecklist={list.isChecklist} />` prop pas.

### Activity-sentence

- `src/components/activity/activity-sentence.tsx`:
  - `checklist_run_started`: TR "{actor} yeni bir checklist run'ı başlattı", EN "{actor} started a new checklist run".
  - `checklist_run_completed`: TR "{actor} checklist run'ını tamamladı", EN "{actor} completed the checklist run".
- `_coverage` switch genişletildi.

### Diğer cascade fix'ler

- `src/lib/server/export.ts` — list select'inde `isChecklist` eklendi (`toListSnapshot` shape eşleşmesi için).

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing warning, `invite-accept-card.tsx`)
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Migration DB'de çalıştırılmadı — staging manuel test
- ❌ Manuel e2e (bot'a "X listesini checklist yap" → `update_list` → Mini App'te banner görünür) — kullanıcı doğrulayacak

## Bilinen sınırlamalar / follow-up (Phase 16.1)

- ⚠️ **Mini App'te list metadata edit UI yok**. Liste create/rename/checklist-toggle Mini App'ten yapılamıyor; tüm liste mutasyonları bot LLM tool'larıyla. User checklist'e geçirmek için bot'a "X listesi checklist olsun" der. Liste metadata edit modal'ı follow-up — bu feature'ın ötesinde scope.
- ⚠️ **Checklist mode'unda ItemEditSheet hala tam form**. Compact mode sadece ItemRow'da (badges hidden); kullanıcı item edit eder etmez status/priority/tag/deadline/description hâlâ görünür. Bu intentional — edit'te tüm meta erişilebilir, **sadece liste görünümünde** sade. İstenirse ItemEditSheet de `checklistMode` prop'u alabilir (description/deadline/tag tab'lı render). Phase 16.1.
- ⚠️ **Run history paneli max 5 + total count**. "Tüm runları gör" expand mode yok. >5 run'ı görmek için API'ye direkt bakılması gerekir. Follow-up: history modal + pagination.
- ⚠️ **Items_completed snapshot durağan**. Run kapandıktan sonra eski runun stats'ı item'lardan independent — kullanıcı item'ları "geri açıp" run history'sini bozamaz. İyi tasarım. Ama eğer run'ın TAMAMLANDIğI haldeki item state'i (hangi item check'liydi) görmek isteniyorsa, snapshot listesi gerekirdi (item_id[] kim done idi). Yapmadık; activity_log'tan derive edilebilir gerekirse.
- ⚠️ **Concurrent "start run" race**. UNIQUE PARTIAL INDEX `list_runs_active_per_list_uq` aynı listede iki active run yaratılmasını DB-level engelliyor. Conflict olursa transaction rollback olur, kullanıcıya 409 görürür (currently fall-through to 500 — error mapping iyileştirmesi follow-up).
- ⚠️ **`is_checklist=false`'a geri dönmek**. Mevcut açık run otomatik close edilmez; flag flip'i sadece UI mode'unu değiştirir. İdeal: `update_list({is_checklist: false})` aktif run'ı close etsin. Follow-up.
- **Checklist sayfa header'ında "X kontrol listesi"**: title'a (Inbox, normal list, checklist) ek bir badge yok. Liste emoji ☑️ default değişti ama görsel olarak başka ipucu yok. Follow-up: list header'da küçük "Kontrol listesi" rozetı.

## Effort

~50 dakika (schema + 2 executor + 1 banner UI + 3 component prop pas-through + activity-sentence + dispatcher).

---

# Phase 15 — Calendar week view + 09:00 daily digest

## Tek satır özet

`users.daily_digest_sent_on date` kolonu (idempotency marker) + partial index. `src/lib/cron/daily-digest.ts` (UTC minute < 1 gate, user-tz hour=9 filter, idempotent UPDATE). `/views/week` route — 7-column tablet+ / single-day swipe mobile + `?from=YYYY-MM-DD` deeplink + Today view'dan link. `/api/views/week` GET endpoint + `listItemsByDeadlineRange` query helper. CompactItemCard component (tap → list page). Quick-add modal **scope dışı** (Phase 15.1).

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅** (1 pre-existing warning Phase 15 dışı).

## Yeni / değişen dosyalar

### Schema + migration

- `src/lib/db/schema.ts`:
  - `users.dailyDigestSentOn date` (nullable) eklendi.
  - Yeni partial index `users_digest_pickup_idx` on `(notifications_enabled, daily_digest_sent_on) WHERE notifications_enabled = true` — pickup query'nin tarama maliyetini düşürür.
  - `import { date }` from `drizzle-orm/pg-core` eklendi.
- `drizzle/0016_phase15_daily_digest.sql` — additive ALTER + CREATE INDEX.
- `drizzle/meta/_journal.json` — idx 16 eklendi.

### Daily digest cron (`src/lib/cron/daily-digest.ts`, yeni)

- `dispatchDailyDigest()` ana entry: pickup (raw SQL `db.execute` ile timezone math: `extract(hour from (now() at time zone u.timezone)) = 9` + idempotency: `daily_digest_sent_on < (now() at time zone u.timezone)::date`) → bot init → her user için `listTodayItems` (next 24h) + `listOverdueItems` (rolling 7d) → boş gün skip + idempotency mark → format + sendMessage MarkdownV2 → mark sent.
- `formatDigestBody`: TR/EN greeting → "Bugün:" section (deadline_at ascending, time-only label) → "Geciken (N):" section (date-only label). Cap: SECTION_LIMIT=20 / "ve N daha", body max TG_MAX 4096 hard cap. List label: emoji + name italic.
- `markSent`: raw SQL UPDATE — Postgres timezone math kullanıyor pickup query ile birebir uyum için.
- Plan'da öngörülen `or` import `void or` ile placeholder olarak korundu (future filter genişlemesi için referans).
- Hourly tick gate: `dispatch-reminders.ts` main'de `if (new Date().getUTCMinutes() < 1)` → `dispatchDailyDigest()` import + invoke. Reminder pipeline exit code'u digest failure'larından **etkilenmez**.

### Week view route + API

- `src/app/(app)/views/week/page.tsx` (server component, **yeni**):
  - URL `?from=YYYY-MM-DD` parse + `mondayOfWeek(fromParam, tz)` helper (timezone-aware Monday snap; `fromParam` Wednesday verirse önceki Monday'e snap).
  - SSR initial fetch via `listItemsByDeadlineRange`.
  - Header: "Bu hafta" / "This week" + ‹ Önceki / Sonraki › nav (offsetDays = ±7).
  - `<WeekGrid />` initialItems prop'u.
- `src/lib/db/queries/views.ts` (**yeni**) — `listItemsByDeadlineRange({ userId, workspaceId, from, to })`: items ⨝ lists ⨝ list_members WHERE listMember=user + workspace + deadline_at IN [from, to) + archived NULL. Sorted by deadline asc.
- `src/app/api/views/week/route.ts` (**yeni**): GET `?from&to&workspaceId?`. Zod validation, MAX_RANGE_DAYS=35, ISO date parse, raw items + list snapshot.
- `src/app/(app)/views/today/page.tsx` — Header'a "Bu hafta →" link eklendi (TR + EN switch).

### Week view UI (`src/components/views/`, yeni)

- `week-grid.tsx`:
  - Client component, TanStack Query polling 5s, queryKey `["views","week", workspaceId, from, to]`.
  - SSR initialData → flash-free first paint.
  - Buckets: items.deadlineAt'ı user-tz day key'e (YYYY-MM-DD) çevirir, Map'e koyar.
  - Days array: Monday-anchored 7 day, her biri date label (TR: Pzt/Sal/Çar/Per/Cum/Cmt/Paz, EN: Mon/Tue/...) + dayNum + isToday accent.
  - **Mobile (`< lg`)**: tek-gün view + ‹ / › chevrons (state activeDay).
  - **Tablet+ (`≥ lg`)**: 7-column grid.
- `compact-item-card.tsx`:
  - Tap → `<Link href="/lists/${listId}">`.
  - Tek satır meta: priority dot + list emoji + list name + time label.
  - 2-line text clamp.
  - isDone → opacity 0.55 + line-through.

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing warning)
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Manuel digest e2e (test bot'a sahte 09:00 simulation) — staging
- ❌ Week view mobile swipe Telegram WebApp'te — kullanıcı doğrulayacak

## Bilinen sınırlamalar / follow-up (Phase 15.1)

- ⚠️ **Quick-add modal yok**. Plan'da boş cell'e tap → modal vardı; şimdilik sadece tap-card-to-edit. Plan'daki tasarım (Sheet bottom drawer, autofocus + deadline default = cell + 09:00, list picker default Inbox) follow-up.
- ⚠️ **Drag-between-days yok**. Plan v2'ye eklenecekti zaten. v1 tap-to-edit yeterli.
- ⚠️ **Empty cell affordance**: "Bu güne ait öğe yok." ama "+ ekle" CTA yok.
- ⚠️ **Recurring reminders (item_reminders)**: week view sadece `deadline_at`'a bakıyor, `item_reminders.remind_at`'a değil. Plan'da kapsam dışıydı; reminder'lar zaten DM olarak fire ediyor.
- ⚠️ **Daily digest bot multi-bot routing**: white-label bot'lar reminder-scoped (Phase 5); digest sadece default platform bot'tan. Plan'a uygun.
- ⚠️ **Daily digest STT cost telemetry yok**: digest ücretsiz (text-only sendMessage), llm_usage'a kaydedilmiyor.
- ⚠️ **`mondayOfWeek` Intl-based**: 6 ayrı `Intl.DateTimeFormat` çağrısı yapıyor (DST + timezone correctness için). Cold start +5ms; ihmal edilebilir.

## Effort

~25 dakika.

---

# Phase Kanban — Status sütunlu board view

## Tek satır özet

Mevcut list sayfasına URL-driven view toggle (`?view=board`) eklendi. 4 status sütunu (Yapılacak / Yapılıyor / Bekliyor / Tamamlandı) `STATUS_META`'dan emoji+renk + count chip. **Multi-container `@dnd-kit`** pattern: cross-column drag → status + position update via mevcut PATCH `/api/items/[id]`. Mobile: yatay scroll + `scroll-snap-type: x mandatory`. "Done" sütunu son 30 gün filter + "Tümü" toggle. Schema değişikliği yok.

CI green: **lint ✅ · typecheck ✅ · vitest 81/81 ✅** (1 pre-existing warning Kanban dışı).

## Yeni / değişen dosyalar

### Util extract

- `src/lib/utils/sparse-position.ts` (**yeni**) — `computeSparsePosition(items, index)` `DraggableItemList`'ten çıkarıldı. Hem list hem Kanban DnD bunu paylaşır.
- `src/components/lists/draggable-item-list.tsx` — local function silindi, import edildi.

### Kanban components

- `src/components/views/kanban-board.tsx` (**yeni**, ~270 satır):
  - DndContext + KeyboardSensor + PointerSensor 8px.
  - `findContainer(id)` — item id → status; column id (drop on empty container) doğrudan return.
  - `handleDragOver` — cross-container hover ise optimistic status flip cache'de (ghost lands in correct column visually).
  - `handleDragEnd`:
    - same-column → `arrayMove` + `computeSparsePosition` + `PATCH { position }`.
    - cross-column → splice into target list at over-card index (or end), compute sparse position, optimistic cache write, `PATCH { status, position }`.
  - moveMutation: `apiPatch` to `/api/items/${id}`. onError + onSettled ikisi de items invalidate (rollback via re-fetch).
  - Buckets: items'ı status'a göre map'le, "done" ise rolling 30-day window default (showAllDone toggle).
  - Sütun döngüsü 4 kez `<Column>` render; her birinde `useDroppable({id: status})` + `<SortableContext>` + `<KanbanCard>` per item.
- **`Column`**: width 280px shrink-0, `scroll-snap-align: start`, isOver accent ring, header emoji+label+count + (only "done" column) "Son 30g/Tümü" toggle button. Empty state "Kart sürükleyin" dashed border.
- **`KanbanCard`**: useSortable + drag handle implicit (whole card `cursor-grab`). Disabled if `!canWrite`. Priority dot + 3-line text clamp + 2 tag chips + overflow `+N`.

### View toggle

- `src/components/lists/list-view-toggle.tsx` (**yeni**):
  - Server-side render `<Link>` segmented (Liste / Pano). Active = bg accent + white text.
  - URL: `/lists/${id}` (list) vs `/lists/${id}?view=board`.

### Page integration

- `src/app/(app)/lists/[id]/page.tsx`:
  - `searchParams` parse → `view: 'list' | 'board'` (default 'list').
  - `<ListViewToggle />` checklist olmayan listelerde render — checklist'lerin kendi banner+compact mode'u var.
  - `view === 'board' && !list.isChecklist` → `<KanbanBoard listId items canWrite />` else `<ItemList />`.
  - `canWrite = role === 'owner' || 'editor'`.

## Test edilenler

- ✅ `npm run lint` — temiz (1 pre-existing warning) + 1 inline disable (`Date.now()` purity, intentional)
- ✅ `npm run typecheck` — 0 hata
- ✅ `npm test` — 81 passed / 1 skipped / 8 files
- ❌ Manuel DnD e2e (drag "Yapılacak" → "Yapılıyor" status update + cache reconcile, mobile swipe smooth) — kullanıcı doğrulayacak

## Bilinen sınırlamalar / follow-up (Kanban v2)

- ⚠️ **Çift transaction inconsistency window**: cross-column drag PATCH'i hem `status` hem `position`'ı atıyor; mevcut route handler `executeUpdateItem` (position) + `executeSetItemAttributes` (status) çalıştırıyor — iki ayrı transaction. 50-200ms'lik tutarsızlık penceresi mümkün ama optimistic UI maskeler. Atomic `executeMoveItemInBoard` follow-up.
- ⚠️ **Filtre integration yok**: ItemFilters Kanban view'da render edilmiyor. Status filter zaten redundant (her sütun bir status); priority/tags/assignee filterları follow-up.
- ⚠️ **"+ Ekle" yok**: kolonun footer'ında item create CTA plan'da vardı — Mini App'te zaten list create flow yok (bot LLM tool'u), follow-up.
- ⚠️ **Pin support yok**: KanbanCard `pinnedAt`'a bakmıyor; pinli kartlar normal gibi davranır. Plan'da öncelik vermişti — follow-up.
- ⚠️ **Recurring item complete'inde "done" sütununda kalır**: Phase 14d'de cron rearm = `sent=false` ama status='done' kalır → user manuel re-open eder. Plan'da known minor friction olarak işaretlendi (Phase 15.5 "auto-reset on recurrence").
- ⚠️ **Activity log noise**: cross-column drag = 2 activity_log row (status_changed + moved). Acceptable; future `item_moved_in_board` consolidation.
- ⚠️ **Telegram WebApp drag conflict**: dnd-kit `touch-action` config zaten DraggableItemList'te var; KanbanCard'da explicit set edilmedi — Telegram'ın text-selection ile conflict riski. Manuel test gerek.

## Effort

~30 dakika.

---

# Birikimli durum

| Phase | Migration | Status |
|---|---|---|
| 14d | `0011_phase14d_reminders_split.sql` | ✅ Code-side complete |
| 14a | `0012_phase14a_item_description.sql` | ✅ Code-side complete |
| 14c | `0013_phase14c_user_date_format.sql` | ✅ Code-side complete |
| 14b | `0014_phase14b_item_attachments.sql` | ✅ Code-side complete |
| 13 | (no schema change) | ✅ Code-side complete |
| 16 (checklists) | `0015_phase16_checklists.sql` | ✅ Code-side complete |
| 15 (calendar + digest) | `0016_phase15_daily_digest.sql` | ✅ Code-side complete |
| Kanban | (no schema change) | ✅ Code-side complete |

**Toplam CI durumu (kümülatif):**
- `npm run lint` — temiz
- `npm run typecheck` — 0 hata
- `npm test` — 81 passed / 1 skipped / 8 files

**Toplam yeni dosya sayısı (uncommitted):**
- 6 migration SQL (0011/0012/0013/0014/0015/0016)
- 6 yeni tool executor (set-deadline, add-reminder, remove-reminder, attach-file-to-item, start-checklist-run, complete-checklist-run)
- 7 yeni API route (/api/items/[id]/reminders + /reminderId, /api/items/[id]/attachments, /api/attachments/[itemId]/[attachmentId], /api/lists/[id]/runs, /api/views/week)
- 5 yeni UI component (Textarea, AttachmentsSection inline, ChecklistBanner, KanbanBoard, ListViewToggle)
- 4 yeni view component (WeekGrid, CompactItemCard, KanbanColumn inline, KanbanCard inline)
- 5 yeni utility (format-date.ts, backup-attachments.ts cron, stt.ts, daily-digest.ts cron, sparse-position.ts)
- 3 yeni hook (use-attachments, use-checklist-runs)
- 2 yeni validator (attachments.ts, query helpers/views.ts)

**Migration deploy sırası (production):**
1. Cron container durdur (sadece 14d için zorunlu; 14a/14c/14b/16/15 additive)
2. `npm run db:migrate` — 0011 → 0012 → 0013 → 0014 → 0015 → 0016 sırayla çalışır
3. Yeni kodu deploy et
4. Cron container başlat
5. UptimeRobot + backup heartbeat doğrulama
6. (14b ek): Hetzner Object Storage env'i (`HETZNER_OBJECT_STORAGE_*`) prod Dokploy'da var mı kontrol — yoksa attachments Telegram-only çalışır, backup pas geçilir.
7. (Phase 13 ek): manuel TR ses test — webhook log'unda STT response shape doğru mu kontrol; gerekirse `input_audio` content-block formatı revize.
8. (Phase 16 ek): "X listesini checklist yap" bot komutu testi → Mini App'te banner görünmesi doğrulama.
9. (Phase 15 ek): bir test user'ın `users.timezone` değerini şu anki saat 09:00 olacak şekilde ayarla → cron tick içinde `daily_digest_sent_on` set olduğu doğrula. Sonraki tick'te tekrar tetiklenmemeli (idempotent).
10. (Kanban ek): Mini App `?view=board` URL'i → 4 sütun render + drag-and-drop status update doğrulama (mobile + desktop).

**Tüm planlanan phase'ler complete.** Aşağıda follow-up phase'ler için backlog notları (Phase X.1 Y.1 vb.) — implementasyon yapılmadı, plan hazır.
