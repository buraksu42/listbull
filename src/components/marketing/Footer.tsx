import Link from "next/link";

import pkg from "../../../package.json" with { type: "json" };

export function Footer() {
  const year = new Date().getUTCFullYear();
  return (
    <footer
      className="mt-12 border-t"
      style={{
        borderColor: "var(--lb-border)",
        background: "var(--lb-subtle)",
      }}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="lb-wordmark text-lg" style={{ letterSpacing: "var(--lb-tracking-wordmark)" }}>
            listbull
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--lb-muted-fg)" }}>
            v{pkg.version} · MIT licensed · No third-party telemetry by default.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <li>
              <a
                href="https://t.me/listbull_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: "var(--lb-fg)" }}
              >
                @listbull_bot
              </a>
            </li>
            <li>
              <a
                href="https://github.com/buraksu42/listbull"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: "var(--lb-fg)" }}
              >
                GitHub
              </a>
            </li>
            <li>
              <Link
                href="/use-the-bot"
                className="hover:underline"
                style={{ color: "var(--lb-fg)" }}
              >
                Commands
              </Link>
            </li>
            <li>
              <Link
                href="/security"
                className="hover:underline"
                style={{ color: "var(--lb-fg)" }}
              >
                Security
              </Link>
            </li>
            <li>
              <a
                href="https://github.com/buraksu42/listbull/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: "var(--lb-muted-fg)" }}
              >
                License
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div
        className="px-6 pb-6 text-center text-xs"
        style={{ color: "var(--lb-muted-fg)" }}
      >
        © {year} listbull contributors.
      </div>
    </footer>
  );
}
