import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * Production: marketing landing + public snapshot pages indexable, Mini App
 * + auth-gated routes disallowed.
 *
 * Test/dev: full disallow — `<meta noindex>` is also set in the root layout
 * for belt-and-suspenders coverage. Test env contains synthetic data and
 * sometimes basic-auth-gated middleware fragments; keep crawlers out
 * entirely.
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
        allow: ["/", "/snapshot/"],
        disallow: [
          "/app/",
          "/lists/",
          "/lists",
          "/settings",
          "/invites/",
          "/api/",
        ],
      },
    ],
    sitemap: `${host}/sitemap.xml`,
    host,
  };
}
