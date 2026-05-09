# listbull — main web app (Next.js 16 + Turbopack build, standalone output).
#
# Multi-stage Node 22 alpine. Two stages:
#   1. builder     — full deps + `next build`. NEXT_PUBLIC_* + Sentry
#                    + Umami arg → env so Turbopack inlines them at
#                    build time (per ~/.claude/CLAUDE.md silent-broken
#                    rule + docs/architecture-pass-phase-4.md § Sentry).
#   2. runner      — final image: copies the .next/standalone bundle
#                    (Next emits a minimal node_modules subset there)
#                    + .next/static + public + messages. ~150MB final
#                    vs. ~250MB with full node_modules. Runs as non-root.

ARG NODE_VERSION=22

# ─── 1. Builder ───────────────────────────────────────────────────
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

ENV SKIP_ENV_VALIDATION=1
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
# --include=dev forces devDependencies (@tailwindcss/postcss, typescript,
# eslint, etc.) even though NODE_ENV=production is set above for the build's
# Next.js process. Without this flag npm ci silently omits devDeps and
# `next build` fails with "Cannot find module '@tailwindcss/postcss'".
# The runner stage doesn't see this — it copies the bundled standalone
# output where Next has already tree-shaken the runtime tree.
RUN npm ci --no-audit --no-fund --include=dev

COPY tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs ./
COPY drizzle.config.ts ./
# Next.js 16 root-level instrumentation hooks. Without these COPYs the
# build runs without `instrumentation.ts` / `instrumentation-client.ts`
# in the context, so Sentry's `register()` + client init never make it
# into the bundle even when @sentry/nextjs is installed and
# `withSentryConfig` wraps next.config. Local builds happened to work
# because they run from the repo root where the files exist.
COPY instrumentation.ts instrumentation-client.ts ./
COPY messages ./messages
COPY public ./public
COPY src ./src
COPY drizzle ./drizzle

RUN npm run build

# ─── 2. Runner ────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=UTC

# Non-root runtime.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Standalone bundle: Next emits a minimal node_modules subset under
# .next/standalone, plus a server.js entry point. Static assets live
# under .next/static and must be copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/messages ./messages

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
