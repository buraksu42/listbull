/**
 * Marketing landing hero — light-only surface, DIY-first OSS framing.
 *
 * Anti-list strict: no glassmorphism, no gradient text, no neon glow, no
 * cosmic imagery, no stock illustrations. Brand mark scales large (~220px
 * desktop, smaller on mobile via clamp), wordmark + tagline below, then
 * two CTAs (Deploy your own → /install, View on GitHub).
 *
 * Primary CTA points at the in-repo install guide, not the hosted bot —
 * the site positions self-hosting as the canonical path. Demo-bot
 * disclosure lives in the footer.
 *
 * a11y: skip link to "How it works" lives at the page-level so it's the
 * very first focusable element.
 */
import Link from "next/link";

import { BrandMark } from "@/components/marketing/brand-mark";
import { GITHUB_URL } from "@/components/marketing/links";

type HeroProps = {
  tagline: string;
  subtitle: string;
  deployLabel: string;
  viewOnGitHubLabel: string;
};

export function Hero({
  tagline,
  subtitle,
  deployLabel,
  viewOnGitHubLabel,
}: HeroProps) {
  return (
    <section
      aria-label="listbull"
      style={{
        padding: "var(--lb-sp-14) var(--lb-sp-4) var(--lb-sp-12)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--lb-sp-6)",
        textAlign: "center",
      }}
    >
      {/* Brand mark scales fluidly: 140px floor (mobile), 240px ceiling
          (wide desktop). 22vw covers the in-between span without media
          queries. */}
      <div
        style={{
          width: "clamp(140px, 22vw, 240px)",
          height: "clamp(140px, 22vw, 240px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <BrandMark size="100%" ariaLabel="listbull" />
      </div>

      <span
        className="lb-wordmark"
        style={{
          fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
          color: "var(--lb-ink-deep)",
        }}
      >
        listbull
      </span>

      <h1
        style={{
          fontSize: "clamp(2.25rem, 5.5vw, 4rem)",
          fontWeight: "var(--lb-fw-bold)",
          letterSpacing: "var(--lb-tracking-title)",
          lineHeight: 1.1,
          maxWidth: 800,
          margin: 0,
        }}
      >
        {tagline}
      </h1>

      <p
        style={{
          fontSize: "clamp(1.05rem, 1.6vw, 1.25rem)",
          color: "var(--lb-muted-fg)",
          lineHeight: 1.55,
          maxWidth: 620,
          margin: 0,
        }}
      >
        {subtitle}
      </p>

      <div
        style={{
          display: "flex",
          gap: "var(--lb-sp-3)",
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: "var(--lb-sp-2)",
        }}
      >
        <Link
          href="/install"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
            padding: "var(--lb-sp-3) var(--lb-sp-6)",
            minHeight: "var(--lb-tap-target)",
            borderRadius: "var(--lb-r-full)",
            background: "var(--lb-accent)",
            color: "var(--lb-accent-fg)",
            fontWeight: "var(--lb-fw-semibold)",
            textDecoration: "none",
          }}
        >
          {deployLabel}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--lb-sp-2)",
            padding: "var(--lb-sp-3) var(--lb-sp-6)",
            minHeight: "var(--lb-tap-target)",
            borderRadius: "var(--lb-r-full)",
            border: "1px solid var(--lb-border)",
            background: "transparent",
            color: "var(--lb-fg)",
            fontWeight: "var(--lb-fw-semibold)",
            textDecoration: "none",
          }}
        >
          {viewOnGitHubLabel}
        </a>
      </div>
    </section>
  );
}
