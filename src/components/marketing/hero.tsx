/**
 * Marketing landing hero — light-only surface.
 *
 * Anti-list strict: no glassmorphism, no gradient text, no neon glow, no
 * cosmic imagery, no stock illustrations. Just the brand mark + wordmark
 * + tagline + subtitle + two CTAs (Open in Telegram, View on GitHub).
 *
 * a11y: skip link to "How it works" lives at the top of the page-level
 * landing component (not here) so it's the very first focusable element.
 */
import Link from "next/link";

import { BrandMark } from "@/components/marketing/brand-mark";
import { GITHUB_URL } from "@/components/marketing/links";

type HeroProps = {
  botUrl: string;
  tagline: string;
  subtitle: string;
  openInTelegramLabel: string;
  viewOnGitHubLabel: string;
};

export function Hero({
  botUrl,
  tagline,
  subtitle,
  openInTelegramLabel,
  viewOnGitHubLabel,
}: HeroProps) {
  return (
    <section
      aria-label="listbull"
      style={{
        padding: "var(--lb-sp-12) var(--lb-sp-4) var(--lb-sp-10)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--lb-sp-6)",
        textAlign: "center",
      }}
    >
      <BrandMark size={72} ariaLabel="listbull" />

      <span
        className="lb-wordmark"
        style={{
          fontSize: "var(--lb-fs-3xl)",
          color: "var(--lb-ink-deep)",
        }}
      >
        listbull
      </span>

      <h1
        style={{
          fontSize: "var(--lb-fs-4xl)",
          fontWeight: "var(--lb-fw-bold)",
          letterSpacing: "var(--lb-tracking-title)",
          lineHeight: 1.15,
          maxWidth: 640,
        }}
      >
        {tagline}
      </h1>

      <p
        style={{
          fontSize: "var(--lb-fs-xl)",
          color: "var(--lb-muted-fg)",
          lineHeight: 1.5,
          maxWidth: 560,
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
        }}
      >
        <Link
          href={botUrl}
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
          {openInTelegramLabel}
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
