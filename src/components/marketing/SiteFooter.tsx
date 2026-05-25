import Link from "next/link";

import pkg from "../../../package.json" with { type: "json" };
import { BrandMark } from "@/components/marketing/BrandMark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col footer-brand">
            <Link href="/" className="wordmark" style={{ fontSize: 16 }}>
              <BrandMark className="mark" />
              <span className="wordmark-text">listbull</span>
            </Link>
            <p>
              A Telegram bot for your to-dos. Bring your own key, or
              use the operator&rsquo;s free tier. Open source,
              self-hostable.
            </p>
          </div>
          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li>
                <Link href="/features">Features</Link>
              </li>
              <li>
                <Link href="/teams">Teams</Link>
              </li>
              <li>
                <Link href="/commands">Commands</Link>
              </li>
              <li>
                <Link href="/install">Install</Link>
              </li>
              <li>
                <a
                  href="https://t.me/listbull_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @listbull_bot ↗
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Security</h4>
            <ul>
              <li>
                <Link href="/security">How we handle your data</Link>
              </li>
              <li>
                <a
                  href="https://github.com/buraksu42/listbull/blob/main/SECURITY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  SECURITY.md ↗
                </a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Project</h4>
            <ul>
              <li>
                <a
                  href="https://github.com/buraksu42/listbull"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/buraksu42/listbull/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  MIT License ↗
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/buraksu42/listbull/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Issues ↗
                </a>
              </li>
            </ul>
          </div>
        </div>
        <aside className="footer-disclaimer" aria-label="Disclaimer">
          <p>
            <strong>Beta software.</strong> listbull is in active
            development; expect occasional bugs, schema migrations,
            and breaking changes. Don&rsquo;t store anything you
            can&rsquo;t afford to re-create or re-enter. We do our
            best, but provide the software <strong>&ldquo;as
            is&rdquo;</strong>, without warranty of any kind — see
            the{" "}
            <a
              href="https://github.com/buraksu42/listbull/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              MIT licence
            </a>{" "}
            for the legal terms.
          </p>
          <p style={{ marginTop: 8 }}>
            <strong>Trust boundary.</strong> The bot encrypts your{" "}
            <code>/password</code> secrets and OpenRouter keys with
            AES-256-GCM and scopes every read/write to your Telegram
            chat; <a href="/security">how we handle your data</a>{" "}
            explains the model. But if a host operator&rsquo;s{" "}
            <code>ENV_KEY</code> leaks, the Telegram app itself is
            compromised, or you hand your bot token to someone, those
            protections fall over. Treat the bot like any other
            chat — sensible information goes in, sensitive secrets
            stay out.
          </p>
          <p style={{ marginTop: 8 }}>
            <strong>Not affiliated with Telegram</strong> or
            OpenRouter. &ldquo;Telegram&rdquo; is a trademark of
            Telegram FZ-LLC.
          </p>
        </aside>
        <div className="footer-meta">
          <span>© {new Date().getUTCFullYear()} listbull. MIT licensed.</span>
          <span>
            prod.listbull.org: cookieless analytics (Umami,
            self-hosted) + crash reports (Sentry). Self-host setups
            are telemetry-free by default.
          </span>
          <span className="pill">v{pkg.version}</span>
        </div>
      </div>
    </footer>
  );
}
