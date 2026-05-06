import type { NextConfig } from "next";
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
  // Phase 5 + 7: server-only packages Turbopack cannot bundle
  // (dynamic require / runtime fs reads). Marked external so Next
  // loads them from node_modules at server boot.
  //   - iyzipay: dynamic require() of resources directory
  //   - @upstash/redis / ratelimit: server-only KV client
  //   - resend: server-only transactional email
  //   - stripe: dynamic typed builders
  serverExternalPackages: [
    "iyzipay",
    "@upstash/redis",
    "@upstash/ratelimit",
    "resend",
    "stripe",
  ],
};

export default withNextIntl(nextConfig);
