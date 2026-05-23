# Brief: redesign the listbull marketing site

You're designing the public marketing surface for **listbull**, an open-source Telegram-native AI to-do bot. Today's site (`test.listbull.org`) is functional but visually weak; I want a real designer pass.

**Deliver:** one self-contained HTML file (inline `<style>`, inline SVG, no build step). It must compose all three pages top-to-bottom in a single document, separated by `<section id="home">`, `<section id="use-the-bot">`, `<section id="security">`. A sticky header lets users jump between them.

**Vibe:** modern open-source dev tool. Think **Linear** (hero typography + density), **Vercel** (developer-trust footer, technical proof), **Cal.com** (feature grid + plain-spoken copy), **Plausible** (no-bullshit security page), **Resend** (clean docs-style example flows). Restrained palette, generous whitespace, technical but warm. No SaaS marketing kitsch.

**Audience:** technical users (developers, ops, power-Telegram users) who self-host things and bring their own keys. They sniff out fluff in 2 seconds.

**Language:** English only. No translations, no i18n switcher.

---

## 1 — What listbull does (product context)

listbull is a Telegram bot. Every Telegram chat (DM or group) is one to-do context — items, reminders, memory, encrypted passwords, all scoped to the chat. No Mini App, no signup, no waitlist. The bot is the surface.

Talking points the marketing site needs to land:

- **Chat-native.** Send a message ("buy milk", "tomorrow 9am dentist"), forward a recipe, drop a voice note — the bot extracts items, sets reminders, keeps a tidy list per chat.
- **BYOK or free tier.** Users paste their own OpenRouter API key for top models, or the operator's shared free-tier key covers them at zero cost.
- **Encrypted passwords.** `/password` stores credentials AES-256-GCM at rest. Reveal sends a 15-second self-destruct message with HTML `<code>` for tap-to-copy.
- **Checklists with gate-complete.** Parent + sub-items. Parent can't close while any child is open — no silently-skipped subtasks.
- **Voice notes, ambient in groups.** DMs transcribe everything. In groups, the bot listens silently and only surfaces actual to-dos — no chatter spam.
- **Open source, self-hostable.** Single Docker compose stack (Postgres + Next.js + cron container). Runs on a 5€ VPS. MIT licensed. No managed dependencies, no third-party telemetry by default.

What it is NOT (don't insinuate these): not a SaaS, not a hosted multi-tenant product, not a Mini App, not a calendar, not an Anthropic/OpenAI product.

---

## 2 — Brand identity (canonical — use as given)

**Mark.** Bull head silhouette in teal (#00D9C0) with two cobalt (#3D7DFF) check-mark horns. Inline this SVG verbatim wherever the logo appears:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-label="listbull">
  <path d="M50 34 C60 34 68 38 72 46 C74 52 74 58 72 64 C68 76 60 84 50 84 C40 84 32 76 28 64 C26 58 26 52 28 46 C32 38 40 34 50 34 Z" fill="#00D9C0"/>
  <path d="M16 22 L26 32 L42 8" stroke="#3D7DFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M84 22 L74 32 L58 8" stroke="#3D7DFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="44" cy="68" r="1.8" fill="#0A1419" opacity="0.55"/>
  <circle cx="56" cy="68" r="1.8" fill="#0A1419" opacity="0.55"/>
</svg>
```

**Wordmark.** The text "listbull" — Inter 700, letter-spacing `-0.035em`, lowercase, no accent dot. Always typeset, never as an image.

**Tone.** Plain-spoken, technically honest, lightly opinionated. "Telegram-native AI to-do bot." Not: "Revolutionize your productivity with AI-powered task management."

---

## 3 — Design tokens (use these — don't invent new ones)

### Palette

```
Brand
  Teal (primary)        #00D9C0
  Cobalt (secondary)    #3D7DFF
  Marigold (accent 3)   #F0A020    /* sparing — use for warnings, not decoration */
  Rose (accent 4)       #E5466F    /* sparing — destructive / deadline-soon */

Neutrals (light theme — use this; the site is light-only)
  bg          #FFFFFF
  fg          #0A0A0A
  card        #F4F4F5
  muted-fg    #707579
  border      #E1E4E8
  subtle      #FAFAFA
  destructive #E53935
  success     #2EB872

Ink-deep (for headlines on contrast blocks)
  #0A1419
```

### Type

Family: `'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`. Load Inter from `https://rsms.me/inter/inter.css`.

Scale (px): 11 / 12 / 14 / 16 / 18 / 22 / 28 / 34. Hero headline can go larger (clamp to ~48–72px). Body default is 14–16px.

Weights: 400 (body), 500 (medium), 600 (semibold — most headings, CTAs), 700 (wordmark, hero).

Letter-spacing: `-0.035em` for the wordmark, `-0.01em` for display/title sizes, `0` for body.

### Spacing (4px base)

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48`. Sections should breathe — generous 80–120px vertical rhythm between sections at desktop.

### Radius

`6 / 10 / 14 / 22 / 9999`. Cards and major surfaces: 14 or 22. CTAs and pills: 9999.

### Elevation (subtle — this isn't a SaaS landing)

```
card:    0 1px 2px rgba(10,20,25,0.04), 0 2px 8px rgba(10,20,25,0.04)
popover: 0 8px 24px rgba(10,20,25,0.16)
```

### Motion

`120ms / 200ms / 320ms`, easing `cubic-bezier(0.2, 0, 0, 1)`. Respect `prefers-reduced-motion`.

---

## 4 — Style direction (more concrete)

**Imitate:**
- **Linear's** hero scale (giant tracking-tight headline, single-line tagline, two CTAs side by side, no graphic clutter).
- **Vercel's** narrow centered content column on text-heavy pages (~720px reading width) and footer density (multi-column link list + license + version).
- **Cal.com's** plain-spoken feature copy ("X does Y for you" instead of "Empower Z with W").
- **Plausible's** transparent security page treatment (claim + technical detail + verifiable link, no marketing hedging).
- **Resend's** clean docs-style worked example blocks (left: user input, right: system response).

**Avoid:**
- Neumorphism, glass morphism, frosted-glass anything.
- Gradients everywhere — one or two restrained accent-tinted gradient washes max.
- A fake hero illustration of a phone with a fake bot conversation. Use the real logo or no illustration.
- Stock "Used by 10,000 teams" or fake customer logo walls.
- Auto-playing video, cookie banners, exit-intent popups.
- Chat-bubble decoration overload (it's a chat product but the site shouldn't be cosplay).
- Emoji-as-icon spam. Real SVG icons or a single icon font, judiciously placed.

**Header / Footer (consistent across all three sections):**

- Header: wordmark left, nav links right (`Features` / `Commands` / `Security` — anchors within the doc), one filled CTA `Try @listbull_bot` (links to `https://t.me/listbull_bot`). Sticky on scroll with a subtle border-bottom that appears after scroll.
- Footer: wordmark + version pin + MIT licence + privacy stance ("No telemetry by default") + GitHub link + Security link. Multi-column on desktop, stacked on mobile.

---

## 5 — Three pages (exact content + structure)

### Page A — `/` (home / landing) — `<section id="home">`

1. **Hero**
   - Wordmark (centered or left, your call).
   - Headline: **Telegram-native AI to-do bot.**
   - Subhead: *Every chat is its own list. Bring your own OpenRouter key — or use the operator's free tier. Open source, self-hostable on a 5€ VPS.*
   - Primary CTA: `Try @listbull_bot` → `https://t.me/listbull_bot`
   - Secondary CTA: `Self-host on GitHub` → `https://github.com/buraksu42/listbull`
   - Tertiary text link: `See commands →` → `#commands`

2. **Live-feeling demo strip** (in place of an animated GIF you don't have)

   A horizontal "chat" composed in CSS — three message bubbles + bot replies, statically composed but designed to feel like a real chat trio. For example:

   ```
   👤 "buy milk, remind me at 6pm"
   🤖 ✓ added. ⏰ 6:00 PM reminder set.

   👤 "weekly cleanup: laundry, dishes, trash"
   🤖 ✓ created 1 parent + 3 sub-items. /items now shows 📂 0/3.

   👤 "what's the gmail password?"
   🤖 🔒 [self-destructs in 15s] [hidden]
   ```

   No animation required. CSS-only "stylized chat" — keep it small, no full Telegram skin imitation.

3. **Feature grid (6 cards)**

   Section heading: **What the bot does.** Sub: *Everything below ships today. No "coming soon".*

   - **Natural-language to-dos** — Type "buy milk" or "tomorrow 9am dentist". The bot creates the item, sets the deadline, drops it on the list.
   - **Checklists with gate-complete** — Group multi-step work under one umbrella. The parent can't close until every child does — no silently-skipped subtasks.
   - **Reminders, group-aware** — DM items remind in your DM; group items remind in the group. Per-minute cron, RRULE-aware for recurring tasks.
   - **Encrypted passwords** — `/password` stores credentials AES-256-GCM at rest. Reveal sends a 15-second self-destruct message with tap-to-copy.
   - **Voice notes, ambient** — DM voice notes get transcribed and captured. In groups, the bot listens silently — to-dos surface, chatter doesn't.
   - **BYOK or free tier** — Paste your own OpenRouter key for top models, or use the operator's shared free-tier key — zero setup, zero cost.

4. **Screenshot mosaic** — 4 slots in a 2×2 (mobile) / 1×4 (desktop) grid. Use a soft accent-tinted gradient as placeholder content (`linear-gradient(135deg, rgba(0,217,192,0.12), transparent 80%)`); caption each with: `/items — your open list`, `Checklist with gate-complete`, `/password — 15s self-destruct`, `/onboarding — 8-step walkthrough`. Real images go here later; placeholders must look intentional, not broken.

5. **Command reference** — `<a id="commands">`. Tight table of all 12 slash commands (see Section 6 for the exact list). On mobile, render as a stacked list; on desktop, a 2-column grid or proper `<table>`.

6. **Testimonial placeholders** — 3 quote cards with the placeholders below + a "DM @buraksu42 to land a real quote here" prompt. Don't make them look like fake fluff — set expectation that they're prompts.

   - "Your testimonial here. Did the bot save you 20 minutes today? Tell us."
   - "Voice notes from the car turning into real reminders. Game-changer."
   - "/password replaced 1Password for my low-stakes shared credentials."

7. **Footer.**

### Page B — `/use-the-bot` — `<section id="use-the-bot">`

1. **Hero**
   - Heading: **Open the bot in Telegram.**
   - Sub: *listbull is fully chat-driven. No Mini App, no signup, no waitlist. Tap below; type a message; you have a to-do list.*
   - Primary CTA: `Open @listbull_bot`
   - Back link: `← Back to home` → `#home`

2. **Command reference** — same 12-row table as the home page (one source of truth).

3. **Worked example flows** — 4 docs-style blocks. Each block: title + a two-column `dt`/`dd` list (👤 input on the left, 🤖 response on the right, Resend-style).

   **Flow 1 — DM, first 60 seconds**

   ```
   👤 /start                                          🤖 Welcome + 🎯 Quick tour button. Tap for an 8-step walkthrough.
   👤 buy milk                                        🤖 ✓ "buy milk" added. /items shows it.
   👤 tomorrow 6pm pay the bill                       🤖 ✓ added with deadline tomorrow 18:00. Row gets 📅.
   👤 remind me about the milk in 1 hour              🤖 🔔 reminder set. In 60 minutes, the bot DMs "⏰ buy milk".
   ```

   **Flow 2 — Checklist, gate-complete in action**

   ```
   👤 weekly cleanup: laundry, dishes, trash          🤖 ✓ created parent + 3 sub-items. /items shows 📂 0/3.
   👤 (tap 📂 → toggle laundry ✅)                    🤖 Parent badge updates to 📂 1/3.
   👤 weekly cleanup done                             🤖 ❌ 2 sub-items still open: dishes, trash. Finish them first, or confirm cascade.
   👤 (toggle remaining children)                     🤖 Parent auto-✅. 📂 3/3 ✅.
   ```

   **Flow 3 — /password — encrypted, self-destruct**

   ```
   👤 /password (in DM only)                          🤖 1/3 — Which label?
   👤 gmail                                           🤖 2/3 — Username / email?
   👤 (you reply with each step)                      🤖 ✅ saved. Suffix shown; encrypted blob AES-256-GCM at rest.
   👤 /password view gmail                            🤖 🔒 username + password in <code>. Self-destructs in 15s.
   ```

   **Flow 4 — Group — ambient voice + tag-based assignment**

   ```
   👤 (add @listbull_bot to group; /setprivacy Disable in BotFather)   🤖 Bot joins; welcome.
   👤 @listbull_bot assign the report to Burak                          🤖 ✓ created with #burak tag. /tag burak lists it.
   👤 (record group voice: "meeting tomorrow 2pm")                      🤖 Silently adds item with deadline. No reply spam.
   👤 (record group voice: "weather's nice")                            🤖 (no reply — nothing actionable.)
   ```

4. **Footer.**

### Page C — `/security` — `<section id="security">`

1. **Hero**
   - Top label: small uppercase "SECURITY" in accent color.
   - Heading: **Every guarantee, linked to source.**
   - Sub: *listbull stores your `/password` secrets and OpenRouter keys AES-256-GCM-encrypted; isolates every chat's data; and authenticates the Telegram webhook with a constant-time secret check. Click any link below to verify against the actual code.*
   - Two reference links inline: full write-up (`SECURITY.md` on GitHub) and a private reporting channel (`GitHub Security Advisories`).

2. **Four claim sections.** Each section: heading + lead paragraph + a list of cards. Each card: title + body + a tiny mono-font "↗ filename" link to the GitHub permalink.

   - **1. Encryption at rest** — *AES-256-GCM via ENV_KEY. Plaintext never reaches the database, never enters the activity log, never appears in any log statement.*
     - **Algorithm** — AES-256-GCM with a 12-byte random IV per encryption and a 128-bit auth tag. Envelope format: `base64(iv ‖ authTag ‖ ciphertext)`. node:crypto only.
       Link: `encryption.ts` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/encryption.ts`
     - **What's encrypted** — `/password` payloads in `items.secret_encrypted`; per-chat BYOK OpenRouter keys in `chats.openrouter_api_key_encrypted`. Both opaque envelope strings in TEXT columns.
       Link: `schema.ts (secret_encrypted)` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/db/schema.ts#L179`
     - **Reveal flow** — Decryption is lazy. Plaintext is sent as HTML `<code>` for tap-to-copy, then auto-deletes after 15 seconds. The activity_log row records `{label, suffix}` only.
       Link: `reveal-secret.ts` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/reveal-secret.ts`

   - **2. Multi-tenant isolation** — *Every Telegram chat is a tenant. No query reads or writes another chat's data; every callback handler verifies chat ownership before mutation.*
     - **Query scoping** — Every executor under `src/lib/server/tools/` filters by `ctx.chatId` before any read or write.
       Link: `search-items.ts (chatId filter)` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/search-items.ts#L40`
     - **Callback verification** — When a user taps an inline button like `item:toggle:<uuid>`, the handler enforces `and(eq(items.id, uuid), eq(items.chatId, currentChatId))` before mutation. A guessed UUID from another chat resolves to nothing.
       Link: `item-action-callback.ts` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/bot/handlers/item-action-callback.ts#L130-L133`
     - **Webhook authentication** — `X-Telegram-Bot-Api-Secret-Token` on every request, verified with `timingSafeEqual`.
       Link: `webhook/route.ts` → `https://github.com/buraksu42/listbull/blob/dev/src/app/api/telegram/webhook/route.ts#L67-L72`
     - **Force-reply contexts** — Multi-step flows key on the composite `(chatId, messageId)`, never on `messageId` alone. Replay across chats impossible.
       Link: `bot-action-contexts.ts` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/db/queries/bot-action-contexts.ts#L62-L67`

   - **3. In transit** — *HTTPS-only end-to-end; the app never listens on a public port directly.*
     - **TLS termination** — Docker Compose binds the app to `127.0.0.1:3000`. A reverse proxy (Caddy / Traefik / Cloudflare) terminates TLS.
     - **Outbound calls** — Only Telegram (the chat surface) and OpenRouter (the LLM turn). No analytics outbound by default — Sentry + Umami are opt-in.

   - **4. Logging discipline** — *No plaintext secret material is logged. The activity_log is the only audit surface.*
     - **Decrypt failures** — Log records `itemId` + a generic error message — never the ciphertext, never the key, never the plaintext.
       Link: `reveal-secret.ts (error path)` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/tools/reveal-secret.ts#L81-L84`
     - **Activity-log payloads** — For secret events, `payload_after` records `{label, secretSuffix}` only.
       Link: `handle-message.ts (secret_created payload)` → `https://github.com/buraksu42/listbull/blob/dev/src/lib/server/bot/handle-message.ts#L1177-L1189`

3. **What we don't promise** — a quieter callout block at the end.

   - The Telegram client itself is out of scope. Plaintext passwords pass through Telegram DMs during the save flow.
   - The bot host machine is out of scope. If `ENV_KEY` leaks (host compromise, env dump), every encrypted blob can be decrypted. Treat the host as the trust boundary.
   - Hardware-backed key storage (HSM, Vault) not yet supported. Future work.

4. **Footer.**

---

## 6 — Command table (use these exact rows, in this exact order)

This is `setMyCommands` ground truth. The site MUST match the Telegram menu.

| Command       | Purpose                                                         |
|---------------|-----------------------------------------------------------------|
| `/items`      | Open to-dos                                                     |
| `/done`       | Completed items (reopen / archive)                              |
| `/memory`     | Memory keepsakes — never auto-deleted                           |
| `/tag <name>` | Items filtered by tag (e.g. `/tag burak`)                        |
| `/today`      | Today's items                                                   |
| `/thisweek`   | Items due this week                                             |
| `/reminders`  | Pending reminders                                               |
| `/password`   | Store / reveal passwords (DM-only save)                         |
| `/settings`   | Language, notifications, formats, OpenRouter key                |
| `/onboarding` | Interactive 8-step walkthrough                                  |
| `/help`       | Command reference                                               |
| `/reset`      | Clear conversation history                                      |

---

## 7 — Acceptance criteria

The HTML you return must:

- Validate as HTML5, semantic (`<header>`, `<main>`, `<section>`, `<article>`, `<nav>`, `<footer>`, real heading hierarchy h1 → h2 → h3).
- WCAG AA contrast everywhere. Teal `#00D9C0` on white fails AA for body text — use it for accents, buttons (`#FFFFFF` text on solid teal), small icon highlights. Body copy goes on `#0A0A0A` (light fg) or `#707579` (muted).
- Mobile-first responsive: render cleanly at 360px, 768px, 1280px. Test the sticky header at 360px.
- Light mode only. Do not include a dark-mode media query — the bot has its own dark theme; the marketing site is intentionally light-only.
- A visible skip link on focus (`Skip to main content`).
- Focus rings visible on all interactive elements (`outline: 2px solid #00D9C0; outline-offset: 2px;` works).
- `prefers-reduced-motion: reduce` zeros transition durations.
- Inter loaded from `https://rsms.me/inter/inter.css`.
- The 12-command table exactly matches Section 6.
- The 4 `/security` claim cards link to the exact permalinks given in Section 5C (not invented ones).
- Footer credits MIT, version `0.1.0`, and "No telemetry by default".

If any acceptance check would force a creative compromise you find degrading, document the tradeoff in an HTML comment at the top of the file and pick the better-looking option — the criteria are a floor, not a ceiling.

---

## 8 — Out of scope

- Logo redesign — the bull-head mark stays as given.
- Marketing copy in any language other than English.
- A new dark mode for the marketing site.
- Animated 3D / WebGL / Lottie illustrations.
- Real screenshots or a real GIF (placeholders are fine; user fills these later).
- Cookie banner / GDPR consent dialog.
- Sign-up form / email collection / waitlist.

---

## 9 — One more thing

The current site at `test.listbull.org` is the baseline you're improving on. If a screenshot is attached, treat it as "what we have today; do better." Don't anchor on it — start from the brief, not the existing layout.

Return a single `.html` file. No build instructions, no `package.json`, no companion files.
