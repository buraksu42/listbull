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

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENV ?? "production",
    tracesSampleRate: 0.05,
    // Replays are off by default — Telegram WebApp viewport is small
    // and replay payload size adds up fast. Flip to 0.1 if a UX bug
    // ever needs visual reproduction.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
