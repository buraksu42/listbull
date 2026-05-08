/**
 * Self-host Umami tracker — single shared instance at
 * `analytics.bullshitapps.com` per the global CLAUDE.md monitoring
 * stack. Renders nothing when `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is unset
 * so dev / preview / unconfigured operators stay quiet by default.
 *
 * Build-time inlining: `NEXT_PUBLIC_*` vars are baked in by Next 16
 * Turbopack at compile time, so the Dockerfile must accept the same
 * arg via `ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID` + `ENV ... = $...` (see
 * docs/launch-checklist-phase-5.md). Runtime env on its own does NOT
 * propagate into the client bundle.
 *
 * Verify post-deploy with:
 *   curl -s https://<host>/ | grep analytics.bullshitapps.com
 * (HTML preload + RSC payload are the inline sites; chunks/*.js scan
 * is a false negative under Turbopack.)
 */
import Script from "next/script";

export function UmamiAnalytics() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!websiteId) return null;

  return (
    <Script
      src="https://analytics.bullshitapps.com/script.js"
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  );
}
