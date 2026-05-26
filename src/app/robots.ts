import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * Production: marketing landing indexable; the API surface + the
 * brand-owner /ops dashboard stay disallowed.
 *
 * Test/dev: full disallow — `<meta noindex>` is also set in the root
 * layout for belt-and-suspenders coverage. Test env contains synthetic
 * data; keep crawlers out entirely.
 */
export default function robots(): MetadataRoute.Robots {
  const isProd = env.NEXT_PUBLIC_ENV === "production";

  if (!isProd) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  const host = env.NEXT_PUBLIC_APP_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/ops/", "/ops", "/api/ops/"],
      },
    ],
    sitemap: `${host}/sitemap.xml`,
    host,
  };
}
