import "./marketing.css";

/**
 * Marketing surface: light-only, no Telegram theme adapter.
 * Force light theme regardless of OS preference.
 *
 * Inter (variable) is preloaded for the wordmark + headlines so the
 * 700-weight tracking-tight title doesn't fall back to system Inter
 * during the first paint.
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-theme="light" className="marketing-root min-h-dvh">
      <link rel="preconnect" href="https://rsms.me" />
      <link
        rel="stylesheet"
        href="https://rsms.me/inter/inter.css"
        crossOrigin="anonymous"
      />
      {children}
    </div>
  );
}
