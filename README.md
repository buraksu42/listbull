# listgram

Telegram-native AI list assistant with persistent shared list memory. A chatty bot + Telegram Mini App, BYOK (bring-your-own OpenRouter key), open source, self-hostable.

## Type
**flagship** — own domain (`listgram.net`), public OSS product.

## Stack
Next.js 16 (App Router, TS strict) + Drizzle + Postgres + Better Auth + Tailwind + shadcn/ui + grammY + `@telegram-apps/sdk-react` + OpenRouter (Anthropic SDK) + Dokploy on Hetzner.

Full handoff (research, architecture, agents plan, design tokens, brand assets, interactive prototype) lives in `handoff/`.

## Environments

| Env | Branch | Server | Domain |
|-----|--------|--------|--------|
| Test | `dev` | 62.238.8.55 | `test.listgram.net` |
| Prod | `main` | 46.224.144.255 | `www.listgram.net` |

Deploy via Dokploy GitHub integration: push `dev` → test, merge `main` → prod.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in DEV values
npm run db:migrate           # apply migrations to local Postgres
npm run dev                  # http://localhost:3000
```

For bot testing locally: expose dev server via tunnel (e.g. `ngrok`) and set the webhook to `<tunnel>/api/telegram/webhook` via BotFather or `setWebhook` API.

## Scripts

- `npm run dev` — Next.js dev server (Turbopack)
- `npm run build` — production build
- `npm run start` — production server
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — `drizzle-kit generate` after schema change
- `npm run db:migrate` — apply migrations
- `npm run db:studio` — Drizzle Studio

## Secrets

- Dev: `.env.local` (gitignored, chmod 600)
- Prod: Dokploy environment variables — never commit real secrets

See `CLAUDE.md` for full project context, gotchas, and phase plan.
