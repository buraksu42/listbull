# End-to-end smoke test runbook

Living test matrix for `@listbull_test_bot` (test deployment). Run
this checklist after any non-trivial bot or executor change. Mark
each row ✅ pass / ⚠️ partial / ❌ fail with notes.

Most rows are interactive Telegram conversations — they require a
human at the keyboard. A few rows (health, deploy verification,
isolation attack) can be driven from the shell against the test
host.

**Setup**
- Test bot: `@listbull_test_bot`
- Test host: `https://test.listbull.org`
- Fresh chat: use `/reset` if reusing a chat that already has state.

## DM flow (1 user)

| # | Step                                                                                                                | Expected outcome                                                                          | Result |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|--------|
| 1 | `/start`                                                                                                            | Welcome message + "🎯 Hızlı tur (3 dk)" inline button.                                    |        |
| 2 | Tap the tour button → walk all 8 steps via `Devam ▶`.                                                              | Each step edits message in place; final step has `Bitir ✓`.                              |        |
| 3 | Direct entry: `/onboarding`, then `Atla ✗` at step 3.                                                              | Returns "Tamam, çıktın. /onboarding ile tekrar başlatabilirsin."                          |        |
| 4 | `süt al`                                                                                                            | Reply confirms add; `/items` shows "süt al" as ☐.                                         |        |
| 5 | `/items` → tap ☐ on the row.                                                                                       | Toggles to ✅; tap again reopens.                                                          |        |
| 6 | `/done`                                                                                                             | Lists the just-completed item; reopen flow works.                                         |        |
| 7 | `yarın 18'de fatura öde`                                                                                            | Item appears with 📅 deadline icon (24h+ → 📅; <24h → ⏳).                                |        |
| 8 | `süt al'ı 1 saat sonra hatırlat`                                                                                    | Row gains 🔔.                                                                              |        |
| 9 | Tap ⏰ button on an item → preset "5 dakika".                                                                       | 🔔 appears; cron fires after ~5min (verify by waiting).                                   |        |
| 10 | `konser biletini hafızaya al`                                                                                       | Appears under `/memory`, NOT `/items`.                                                    |        |
| 11 | `/password` → label `gmail` → username `test@example.com` → password `correctHorseBatteryStaple`.                  | Each step requested via force-reply; final "✅ kaydedildi" + suffix.                       |        |
| 12 | `/password list`                                                                                                    | Shows `gmail · test@... · ****aple`. No plaintext anywhere.                                |        |
| 13 | Tap `gmail` row → reveal.                                                                                          | Message with `<code>` username + password; **counts down 15s and self-deletes**.          |        |
| 14 | `/password view gmail` (direct).                                                                                    | Same as #13.                                                                              |        |
| 15 | `haftalık temizlik: çamaşır, bulaşık, çöp`                                                                          | Creates parent `haftalık temizlik` + 3 children. `/items` shows parent with `📂 0/3`.    |        |
| 16 | Tap `📂` on parent → sub-items view.                                                                                | Lists 3 children with toggle + actions; `← Geri` works.                                   |        |
| 17 | Toggle 1 child.                                                                                                     | Parent badge updates to `📂 1/3`. Parent NOT yet ✅.                                       |        |
| 18 | Try to complete parent directly: `haftalık temizlik tamamlandı`.                                                   | Bot returns gate phrase: "2 alt item açık..." (does not silently complete).               |        |
| 19 | Toggle the remaining 2 children.                                                                                    | Parent auto-✅. Badge becomes `📂 3/3 ✅`.                                                 |        |
| 20 | `haftalık temizlik'i sil`                                                                                            | Confirmation: "haftalık temizlik ve 3 alt item silinecek. Devam?"                         |        |
| 21 | Confirm.                                                                                                            | All 4 items archived in one tx; activity_log has 4 rows.                                  |        |
| 22 | `ekmek al #market` then `/tag market`                                                                                | "ekmek al" listed under `/tag market`.                                                    |        |
| 23 | `/today`, `/thisweek`, `/reminders`                                                                                 | Each returns expected rows for the chat.                                                  |        |
| 24 | `/settings` → toggle lang TR ↔ EN.                                                                                  | Subsequent replies in the new locale.                                                     |        |
| 25 | `/settings` → toggle notif off → on.                                                                                | State persists across `/settings` re-opens.                                               |        |
| 26 | `/settings` → 🔑 → paste an OpenRouter key (or fake `sk-or-v1-...` for force-reply UX check).                       | "key kaydedildi" + state shows "🔑 key var".                                              |        |
| 27 | `/settings` → 🔑 kaldır.                                                                                            | Falls back to free tier. Subsequent message shows free-tier nudge **once**.               |        |
| 28 | Send second message after #27.                                                                                      | Nudge does NOT repeat.                                                                    |        |
| 29 | Record a voice note (DM, with own key): "ekmek al ve sütü unutma".                                                  | Both items added; bot replies "2 item eklendi".                                           |        |
| 30 | `/reset`                                                                                                            | Conversation cleared; next message starts fresh (no history bleed).                       |        |

## Group flow (bot + 2 humans)

| # | Step                                                                                                                | Expected outcome                                                                          | Result |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|--------|
| 31 | Create new test group; invite `@listbull_test_bot` (with **/setprivacy Disable**).                                  | Bot joins; sends welcome / onboarding hint.                                               |        |
| 32 | `@listbull_test_bot süt yumurta peynir`                                                                              | 3 items added to the group's `/items`.                                                    |        |
| 33 | Record a group voice note containing a to-do: "yarın toplantı 14:00".                                                | Item added silently; bot may or may not reply (intent: don't spam).                       |        |
| 34 | Record a group voice note that's chatter: "havalar güzelmiş".                                                       | Bot stays silent; nothing added; no LLM cost.                                              |        |
| 35 | `@listbull_test_bot süt al'ı 2 dakika sonra hatırlat`                                                                | Reminder set on group item.                                                                |        |
| 36 | Wait 2 minutes.                                                                                                     | Reminder fires **in the group**, not DM.                                                  |        |
| 37 | Group: `/password` save attempt.                                                                                    | Bot rejects: "şifre kaydı sadece DM'de".                                                  |        |
| 38 | DM bot from member B (who is also in the group), save a `bank` password.                                            | Saved in DM. List shows it under member B's DM only.                                       |        |
| 39 | In the group, ask `bank şifresi ne?`                                                                                | Bot rejects in group OR redirects to DM (verify behavior is consistent).                  |        |
| 40 | `@listbull_test_bot @userB raporu yap`                                                                              | Item created with tag `userb`. `/tag userb` filters.                                       |        |

## Free-tier flow

| # | Step                                                                                                                | Expected outcome                                                                          | Result |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|--------|
| 41 | Fresh user (no DB row), `/start` in DM, send a message without setting a key.                                       | Bot processes via shared key + free model. Nudge appears once.                            |        |
| 42 | Second message in same chat.                                                                                         | No nudge repeat.                                                                          |        |
| 43 | Set an OpenRouter key via `/settings`.                                                                              | Subsequent calls use the user key (verify via OpenRouter dashboard if accessible).        |        |
| 44 | Remove the key.                                                                                                     | Falls back to free model; nudge shows once more for the post-removal session.             |        |

## Isolation attack test

| # | Step                                                                                                                | Expected outcome                                                                          | Result |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|--------|
| 45 | From User A's chat, copy an `item:toggle:<uuid>` callback URL (inspect via grammY debug or by introspecting buttons). | Have the UUID for one of A's items.                                                       |        |
| 46 | From User B's account (different Telegram user), construct a callback with A's UUID.                                | Bot must NOT mutate. Either silently no-ops or shows "öğe bulunamadı".                    |        |
| 47 | DB check: A's item is unchanged.                                                                                    | Confirms `and(items.id, items.chatId)` AND-guard works.                                   |        |

## Deploy / infra verification

| # | Step                                                                                                                | Expected outcome                                                                          | Result |
|---|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|--------|
| 48 | `curl -s https://test.listbull.org/api/health`                                                                      | `{"status":"ok","db":"ok","bot":"ok",...}`                                                |        |
| 49 | Bundle scan (Sentry DSN inline): `curl -s https://test.listbull.org/_next/static/chunks/*.js \| grep -E 'sentry'`    | At least one match (if Sentry configured).                                                |        |
| 50 | HTML scan (Umami): `curl -s https://test.listbull.org/ \| grep analytics.bullshitapps.com`                          | At least one match (if Umami configured).                                                 |        |
| 51 | `/security` page renders; every permalink in SECURITY.md resolves.                                                  | All GitHub permalinks 200 OK; no 404s.                                                    |        |

## Reporting

After each run, paste the filled table into the PR or commit
message. Bugs surfaced become tracked work; fix → retest → tick.

A row stays ❌ until fixed. Do not move on to landing-page polish
while smoke is red — site copy can lie about features but the bot
must not.
