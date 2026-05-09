import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Standalone output: ships .next/standalone with the minimum
  // node_modules tree needed at runtime. Dockerfile copies that subset
  // instead of full node_modules → ~250MB → ~150MB image.
  output: "standalone",
  // Server-only packages Turbopack cannot bundle (server-only KV client).
  serverExternalPackages: ["@upstash/redis", "@upstash/ratelimit"],
};

// Sentry's wrapper installs the Webpack/Turbopack plugin needed to
// keep `@sentry/nextjs` imports alive through tree-shaking and to
// upload source maps when SENTRY_AUTH_TOKEN is set at build time.
// Without this wrapper, `instrumentation-client.ts`'s `Sentry.init`
// call gets dead-code-eliminated and the browser bundle ships
// without the SDK — exactly the silent-broken pattern that bit the
// previous deploy.
const sentryOptions = {
  // Org + project come from env at build time so the wrapper can
  // upload source maps when SENTRY_AUTH_TOKEN is also set. Both are
  // optional — runtime error reporting still works without them.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Suppress the "no auth token" warning at build time when source
  // maps aren't being uploaded. Disable this when source maps land.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Skip the dev-mode telemetry banner.
  telemetry: false,
};

export default withSentryConfig(withNextIntl(nextConfig), sentryOptions);
