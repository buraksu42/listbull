# listgram

<One line description — what this project does>

## Type
**flagship** — This is a flagship project — uses its own custom domain. Replace the examples above with the actual domain once decided.

## Stack
Default: Next.js (App Router, TS strict) + Supabase + Drizzle + Tailwind + Dokploy on Hetzner.
Override in this project's CLAUDE.md if different.

## Environments
| Env | Branch | Server | Domain |
|-----|--------|--------|--------|
| Test | `dev` | 62.238.8.55 | `test.listgram.com      (example — set your actual domain)` |
| Prod | `main` | 46.224.144.255 | `www.listgram.com       (example — set your actual domain)` |

Deploy is handled by Dokploy's GitHub integration:
- Push to `dev` → test server
- Merge to `main` → prod server

## Setup
```bash
npm install
cp .env.example .env.local   # Already done by scaffolder; fill in actual values
npm run dev
```

## Scripts
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript strict check

## Secrets
- Dev: `.env.local` (local only, never commit)
- Prod: Dokploy environment variables (set via Dokploy dashboard)

See `CLAUDE.md` for project-specific context and architecture notes.
