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
};

export default withNextIntl(nextConfig);
