import Link from "next/link";

import {
  ArrowRightIcon,
  GitHubIcon,
  TelegramIcon,
} from "@/components/marketing/BrandMark";
import pkg from "../../../package.json" with { type: "json" };

/**
 * Home hero — wordmark-free (the sticky header already shows it),
 * giant Linear-style headline, two CTAs side by side, and a meta
 * strip of project facts (live, license, telemetry, version).
 */
export function Hero() {
  return (
    <div className="hero-section">
      <div className="hero-wash" aria-hidden />
      <div className="container hero-inner">
        <h1>Telegram-native AI to-do bot.</h1>
        <p className="lead">
          Every chat is its own list. Bring your own OpenRouter key —
          or use the operator&rsquo;s free tier. Open source,
          self-hostable on a 5€ VPS.
        </p>
        <div className="hero-ctas">
          <a
            className="btn btn-primary"
            href="https://t.me/listbull_bot"
            target="_blank"
            rel="noopener noreferrer"
          >
            <TelegramIcon />
            Try @listbull_bot
          </a>
          <a
            className="btn btn-secondary"
            href="https://github.com/buraksu42/listbull"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubIcon />
            Self-host on GitHub
          </a>
          <Link href="/commands" className="text-link">
            See commands
            <ArrowRightIcon />
          </Link>
        </div>
        <div className="hero-meta" aria-label="Project status">
          <span>
            <span className="dot" /> Live on Telegram
          </span>
          <span>MIT licensed</span>
          <span>No telemetry by default</span>
          <span>v{pkg.version}</span>
        </div>
      </div>
    </div>
  );
}
