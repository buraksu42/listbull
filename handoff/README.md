# listbull — Engineering Handoff

> Telegram-native AI list assistant with persistent shared list memory.
> A Telegram Mini App + a chatty bot, with bring-your-own-key AI.

This folder is the **single source of truth** for building listbull. Everything you need — product spec, architecture, agent design, visual design, brand assets, design tokens, and an interactive design reference — is here.

---

## 📂 What's in this folder

```
handoff/
├── README.md                              ← you are here
├── specs/                                 ← product & technical specs
│   ├── CLAUDE.md                          ← project overview · start here
│   ├── research.md                        ← user research, market, scope
│   ├── architecture.md                    ← stack, infra, CI, deploy
│   ├── agents.md                          ← AI agent architecture (intent routing, tools)
│   └── design.md                          ← UX rules, layout, type, anti-patterns
├── design-reference/
│   └── listbull (standalone).html         ← OPEN THIS · interactive prototype of all 7 surfaces
├── brand/                                 ← logo & icon (Direction C · "Sent")
│   ├── listbull-mark.svg                  ← primary mark, full color
│   ├── listbull-mark-mono.svg             ← single-fill (currentColor) for stickers/silhouette
│   ├── listbull-lockup-horizontal.svg     ← mark + wordmark
│   └── listbull-app-icon-1024.svg         ← masked app-icon tile · 1024×1024
└── tokens/                                ← design tokens
    ├── tokens.json                        ← W3C-style token export
    └── tokens.css                         ← drop-in CSS custom properties
```

---

## 🚀 Quickstart for engineers

1. **Read `specs/CLAUDE.md` first** — it's the 5-minute project overview.
2. **Open `design-reference/listbull (standalone).html` in a browser** — fully interactive, offline. Click any artboard label to focus it. Toggle the **Tweaks** button (bottom right) to swap accent color, checkbox style, theme, etc.
3. **Drop `tokens/tokens.css` into your app's global stylesheet** — every color, font size, spacing, radius, and motion token is wired up.
4. **Use the SVGs in `brand/`** as-is. The mark is path-only, optimised for any size from 16px favicon to app-icon.

---

## 🎨 Design system at a glance

### Brand
- **Mark**: chat bubble + checkmark inside · "Direction C · Sent"
- **Accent**: `#00D9C0` teal (default), with cobalt / marigold / rose alternates
- **Ink-deep**: `#0A1419` — used as the check-cutout color, sits on top of accent
- **Wordmark**: Inter 700, `-0.02em` tracking, all-lowercase

### Themes
Two themes ship together: light and dark. **Default to dark** to match Telegram's Mini App default.
Use `[data-theme="light|dark"]` on `<html>` to switch. The CSS file also respects `prefers-color-scheme`.

### Type
Single family: **Inter**. Self-host via `next/font` or fontsource — never load from Google in production (privacy + perf).

### Spacing & radius
4px base spacing scale. Cards use `--lb-r-lg` (14px). The app-icon tile uses `--lb-r-xl` (22px) at 1024 size — scales proportionally.

---

## 🧱 Component conventions baked into the design

These are the patterns the design assumes. Implement once, reuse everywhere.

| Component        | Spec                                                                                  |
|------------------|---------------------------------------------------------------------------------------|
| **Item row**     | 56px tall · circular checkbox left · title + meta · drag handle on long-press        |
| **Checkbox**     | 22×22 circle · stroke `--lb-muted-fg` unchecked · fills `--lb-accent` checked        |
| **Composer**     | Bottom-fixed pill · 44px tall · placeholder "Add an item or ask listbull…"           |
| **App header**   | 52px · platform-native (iOS large title / Android M3 small app bar)                   |
| **List icon**    | One emoji per list (allowed exception to the no-emoji rule) — see `design.md`        |
| **Activity row** | Avatar · "Ahmet completed 3 items" · timestamp · undo within 10s                     |

---

## 🔌 Telegram Mini App integration notes

- Bridge `tg-theme-*` CSS vars to our `--lb-*` tokens at app boot. Map:
  - `--tg-theme-bg-color` → `--lb-bg`
  - `--tg-theme-text-color` → `--lb-fg`
  - `--tg-theme-hint-color` → `--lb-muted-fg`
  - `--tg-theme-link-color` → `--lb-accent` (only if user hasn't set custom accent)
- Respect `WebApp.colorScheme` for initial theme.
- The composer must clear viewport on `WebApp.viewportChanged` (keyboard up).
- Wire `WebApp.MainButton` for primary actions on Settings / Share screens.

---

## 🤖 BYOK (bring your own key) — implementation reminders

- Keys are **stored client-side only** (Mini App localStorage + optionally synced encrypted to your backend with the user's Telegram ID as salt). Never log them.
- The settings screen makes the trust model explicit: *"listbull uses your key — your usage, your bill."* Keep that copy.
- Show a redacted preview (`sk-••••5f2a`) once stored, and a one-tap "Replace key" affordance.

---

## 🎯 What's NOT in this handoff (decisions still needed)

Before sprint planning, confirm:

1. **Hosting / domain** — `listbull.org` DNS owner, where the Mini App is served from.
2. **Telegram bot token** — who creates it, where it's stored (env var, secret manager).
3. **BYOK persistence** — client-only or encrypted-at-rest sync? (changes the threat model)
4. **Data model finalization** — lists, members, audit log schema (architecture.md has a draft, confirm)
5. **i18n** — TR + EN at launch; pick the source-of-truth library (i18next, etc.)
6. **Analytics** — what events, what tool, privacy policy
7. **Launch scope** — all 7 surfaces in MVP, or Mini App + bot first, then marketing/audit?
8. **Pricing** — free forever vs. future Pro tier (affects the BYOK story)
9. **Access** — closed beta, open launch, waitlist?

---

## 📞 Working with this handoff

- The standalone HTML is the **canonical visual spec**. If a token in code disagrees with the HTML, the HTML wins (and tell the designer).
- Tokens are versioned with the design — bump `tokens.json` `brand.version` whenever you ship a visual change.
- The brand SVGs use the accent color hard-coded as `#00D9C0`. If you want themeable marks, swap to `currentColor` and pass `style="color: var(--lb-accent)"` from the parent.

Built with Claude on 2026-05-01. Direction C ("Sent") chosen 2026-05-01.
