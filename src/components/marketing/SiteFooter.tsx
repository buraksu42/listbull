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
                <Link href="/commands">Commands</Link>
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
                <Link href="/security">Guarantees</Link>
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
              <li>
                <a
                  href="https://github.com/buraksu42/listbull/security/advisories"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Report privately ↗
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
        <div className="footer-meta">
          <span>© {new Date().getUTCFullYear()} listbull. MIT licensed.</span>
          <span>No telemetry by default. No cookies. No tracking.</span>
          <span className="pill">v{pkg.version}</span>
        </div>
      </div>
    </footer>
  );
}
