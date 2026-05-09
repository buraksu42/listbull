/**
 * Sentry server-side instrumentation (Next.js 16 convention).
 *
 * Replaces the deprecated `sentry.server.config.ts` pattern. Next 16
 * Turbopack only loads modules registered through `register()` here;
 * top-level `Sentry.init()` calls in the legacy file get silently
 * dropped during build. This is the same gotcha that bites the
 * client-side init — see `instrumentation-client.ts`.
 *
 * `onRequestError` is the App Router hook for unhandled errors in
 * route handlers / RSCs / server actions. Wiring it through Sentry
 * captures every server crash without try/catch boilerplate.
 *
 * DSN is opt-in: if `NEXT_PUBLIC_SENTRY_DSN` is unset, Sentry's init
 * becomes a no-op and the bundle stays unaffected.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_ENV ?? "production",
      tracesSampleRate: 0.05,
      // Don't ship PII (Telegram first names / usernames flow through
      // many request paths). `sendDefaultPii: false` is the Sentry
      // SDK default; set explicitly so a future env override is
      // visible in code review.
      sendDefaultPii: false,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_ENV ?? "production",
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
