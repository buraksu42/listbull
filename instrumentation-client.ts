/**
 * Sentry client-side instrumentation (Next.js 16 convention).
 *
 * **CRITICAL**: in Next 16 Turbopack, the legacy `sentry.client.config.ts`
 * file is silently dropped during build — Sentry init won't run, the
 * bundle scan still finds the SDK code, and you only realize it's
 * broken when no events show up in the dashboard. The standard Next
 * 16 path is `instrumentation-client.ts` at the repo root; that's
 * what's loaded into the browser entry chunk.
 *
 * Bundle scan to confirm SDK shipped:
 *   curl https://<host>/_next/static/chunks/*.js |
 *     grep -E 'ingest\.(de\.)?sentry\.io|@sentry|sentryDsn'
 *
 * Live event check: any client-side throw or unhandled promise will
 * land in the Sentry dashboard within seconds. The 502 byte-proxy
 * fetches we currently see in the wild will surface here as
 * `<img onerror>` events.
 */
import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "@/lib/sentry-scrub";

// `Sentry.init` is called unconditionally — when DSN is undefined the
// SDK gracefully becomes a no-op, but the import + init call must
// land in the browser bundle either way. The previous
// `if (process.env.NEXT_PUBLIC_SENTRY_DSN)` gate caused Turbopack to
// tree-shake the entire @sentry/nextjs import out of the bundle when
// the env var was unset at build time, leaving the dashboard empty
// and the bundle scan blank — silent broken.
//
// Replays off by default — Telegram WebApp viewport adds payload
// pressure fast. Flip to 0.1 if a UX bug needs visual reproduction.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_ENV ?? "production",
  tracesSampleRate: 0.05,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
  // See `src/lib/sentry-scrub.ts` for pattern list.
  beforeSend: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
