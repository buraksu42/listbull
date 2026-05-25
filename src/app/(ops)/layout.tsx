import type { Metadata } from "next";

/**
 * Brand-owner ops route group. Forces `noindex` even on prod (robots.ts
 * already disallows /ops/ but this is belt-and-suspenders if a search
 * engine ignores robots.txt).
 *
 * Intentionally minimal — no marketing chrome, no Mini App theme adapter.
 * The basic-auth gate lives in `src/middleware.ts`; if you can render
 * this layout, you're already authorised.
 */
export const metadata: Metadata = {
  title: "listbull · ops",
  robots: { index: false, follow: false, noimageindex: true },
};

export default function OpsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <section className="min-h-dvh bg-zinc-50 text-zinc-900">{children}</section>;
}
