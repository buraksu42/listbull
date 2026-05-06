# Contributing to listbull

Thanks for taking a look. listbull is OSS, self-host-friendly, and
solo-maintained — contributions are welcome but the project has a
specific shape worth understanding before you open a PR.

## Reporting bugs

Please file a [GitHub issue](https://github.com/buraksu42/listbull/issues/new)
with:

- What you tried (a single sentence: "I forwarded a recipe with 30
  items to the bot…")
- What you expected
- What actually happened
- Repro steps if you can isolate them
- Your environment (self-host or hosted, Postgres version, Node
  version if running outside Docker, browser if it's a Mini App bug)

For security issues, **don't open a public issue** — DM
[@buraksu](https://github.com/buraksu42) on GitHub or email
mburaksu@gmail.com.

## Feature requests

Open an issue with the "feature request" label. Describe the use case
first (what task / friction surfaces the need), THEN the proposed UX.
Issues that lead with "the system should X" are 5× harder to evaluate
than "I'm trying to do Y and X is in the way".

The roadmap is shaped phase-by-phase via `docs/architecture-pass-phase-*.md`
contracts. New features that fit the existing agent-ownership boundaries
(see `handoff/specs/agents.md`) move fast; cross-cutting features need
an Architect-pass review first.

## Dev setup

Follow the [Quickstart in README.md](README.md#quickstart-self-host)
to bring up Docker. For local dev WITHOUT Docker:

```bash
# 1. Postgres locally (Homebrew, Docker, whatever)
createdb listbull

# 2. Clone + install
git clone https://github.com/buraksu42/listbull.git
cd listbull
npm install

# 3. .env.local (chmod 600)
cp .env.example .env.local

# 4. Migrate + run
npm run db:migrate
npm run dev
```

Bot dev locally: expose `localhost:3000` via ngrok (or Tailscale
Funnel), then point the webhook there.

## Code conventions

The full engineering rubric lives in
[`handoff/specs/CLAUDE.md`](handoff/specs/CLAUDE.md). Highlights:

- **TypeScript strict mode**, no `any`, no `@ts-ignore` (use proper
  types or document the gap as `@ts-expect-error` with a reason).
- **Server vs. client**: React Server Components by default; opt
  in to `"use client"` only for event handlers / hooks / browser APIs.
- **DB writes**: every executor wraps writes in a single Drizzle
  transaction (Inv-1).
- **Validators**: every API endpoint defines its request + response
  schemas under `src/lib/validators/`. Frontend imports types from
  there — never declares response shapes inline.
- **Layering**: `src/lib/db/**` MUST NEVER import from
  `src/lib/server/**`. The dependency direction is documented in
  `docs/architecture-pass-phase-4.md` § P2-7.
- **Comments in English**, error messages shown to end users in
  Turkish (project default; falls through to `users.locale`).
- **No emojis in code or comments unless explicitly requested.**

## Agent ownership boundaries

This project is built across four agent roles (Architect / AI /
Backend / Frontend / Reviewer). Each owns a tree:

- `src/lib/types/` + `docs/architecture-pass-*.md` → Architect
- `src/lib/ai/` → AI agent (prompts, tool schemas, conversation slicing)
- `src/lib/server/`, `src/lib/cron/`, `src/lib/db/`, `src/lib/validators/`,
  `src/app/api/` → Backend
- `src/app/(app)/`, `src/app/(marketing)/`, `src/components/`,
  `src/i18n/` → Frontend
- `README.md`, `Dockerfile*`, `docker-compose.yml`, `tests/`,
  `.github/workflows/` → Reviewer

If a PR crosses boundaries, that's fine — call it out in the
description so the next contributor knows the layering was a conscious
choice, not drift.

## PR process

- **Branch from `dev`**, not `main`. Push to `dev` deploys to test;
  merge `dev → main` deploys to prod.
- **Branch naming**: `feat/<short>`, `fix/<short>`, `chore/<short>`.
- **Commit messages**: imperative mood, ≤72 chars, English.
- **CI must pass** (`lint`, `typecheck`, `test`). The gitleaks
  workflow also runs; it'll flag committed secrets.
- **Self-merge is allowed** for small, low-risk PRs (typo fixes,
  doc tweaks, dependency bumps inside a single major). Anything
  touching contract files (`src/lib/types/index.ts`, `src/lib/db/schema.ts`,
  `src/lib/ai/tools.ts`) needs a second look — open the PR, sleep
  on it, then merge.
- **No force-push to `main` or `dev`**.

## Tests

The strict-gate Phase 4 baseline:

```bash
npm test          # Vitest unit suite (fast, no DB)
npm run e2e       # Playwright (live tests gated behind LISTBULL_E2E_LIVE=1)
```

Critical-path coverage required for any PR that touches:

| Area | Test |
|---|---|
| `src/lib/server/encryption.ts` | `tests/unit/lib/server/encryption.test.ts` |
| `src/lib/ai/conversation.ts` | `tests/unit/lib/ai/conversation.test.ts` |
| `src/lib/auth/telegram-plugin.ts` | `tests/unit/lib/auth/telegram-plugin.test.ts` |
| Any of the 9 executors | `tests/unit/lib/server/tools/executors-input-validation.test.ts` |
| `src/lib/server/lists/snapshot-token.ts` | `tests/unit/lib/server/lists/snapshot-token.test.ts` |
| `messages/{tr,en}.json` | `tests/unit/i18n/locale-parity.test.ts` (Inv-19) |

If your change makes one of these obsolete, update or replace — never
delete without replacement.

## Anti-patterns

A handful of patterns that will get a PR pushed back:

- **Adding a dependency casually**. Every dep is reviewed against
  bundle size, maintenance status, and "could a 30-line helper
  replace it?". The bar is high.
- **Crossing layer boundaries** without an Architect pass. Specifically:
  no `src/lib/db/**` → `src/lib/server/**` imports; no
  `src/lib/ai/**` → DB imports.
- **Adding a new shared type outside `src/lib/types/index.ts`** when
  it's used by 2+ consumers. Architect-agent owns that file.
- **Inlining a response shape** in a Frontend component when the
  Backend already exports one in `src/lib/validators/`. Always
  import.
- **Reaching past `handoff/specs/`** to add product features. The
  research → design → architecture → agents pipeline is the source
  of truth; PRs that skip it land in "would-be-nice-but-deferred".

## Anti-list (design system)

The Mini App design system has explicit anti-patterns documented in
`handoff/specs/design.md` § "Anti-list". Don't introduce:

- Drop shadows on cards (use border + bg-neutral-50 instead).
- Pill-shaped buttons (we use rounded-md, never rounded-full for
  primary actions).
- Right-aligned destructive actions in confirmation dialogs (we use
  bottom-stacked, primary-on-top).
- Animations longer than 200ms (snap, don't ease).

Read the spec before redesigning anything.

---

Thanks again. listbull is small and opinionated; contributions that
fit the shape are appreciated, and bugs are taken seriously.
