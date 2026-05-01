/**
 * Marketing surface: light-only, no Telegram theme adapter.
 * Force light theme regardless of OS preference.
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-theme="light" className="min-h-dvh">
      {children}
    </div>
  );
}
