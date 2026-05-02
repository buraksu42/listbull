# listgram — main web app (Next.js 16 + Turbopack build).
#
# Multi-stage Node 22 alpine. Three stages:
#   1. deps        — production-only dep install for the runtime layer
#   2. builder     — full deps + `next build`. NEXT_PUBLIC_* + Sentry
#                    + Umami arg → env so Turbopack inlines them at
#                    build time (per ~/.claude/CLAUDE.md silent-broken
#                    rule + docs/architecture-pass-phase-4.md § Sentry).
#   3. runner      — final image: prod node_modules + .next + public +
#                    minimal config files. Runs as non-root.
#
# Note: Phase 5 follow-up — switch to `output: "standalone"` in
# next.config.ts to ship a tinier image. Architect owns that flip.

ARG NODE_VERSION=22

# ─── 1. Production deps ───────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# We need the lockfile so `npm ci` is reproducible.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ─── 2. Builder ───────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

# Build-time public env. These MUST be passed via Dokploy's
# `buildArgs` (or `--build-arg` locally) to be inlined into the
# client bundle. Empty strings are fine — they just disable the
# corresponding integration.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ENV
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID

ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV NEXT_PUBLIC_UMAMI_WEBSITE_ID=${NEXT_PUBLIC_UMAMI_WEBSITE_ID}

# Skip env validation during build; runtime env validation still applies.
ENV SKIP_ENV_VALIDATION=1
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY drizzle.config.ts ./
COPY messages ./messages
COPY public ./public
COPY src ./src
COPY drizzle ./drizzle

RUN npm run build

# ─── 3. Runner ────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=UTC

# Non-root runtime — the official `node` image already has a `node`
# user (uid 1000) which we use directly.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Production deps.
COPY --from=deps   /app/node_modules ./node_modules
# Build artifacts.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/messages ./messages
# Config files needed at runtime.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs

EXPOSE 3000

# `next start` reads next.config.ts at boot. If you switch to
# `output: "standalone"` later, replace this with `node server.js`
# from the standalone bundle.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
