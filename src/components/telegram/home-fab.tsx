"use client";

import { Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Floating "home" button — backup affordance for users on
 * surfaces where the Telegram BackButton chrome isn't available
 * (web browser, desktop Telegram in some clients) OR where back-
 * navigation history is empty (deeplink direct entry). Renders
 * everywhere inside `(app)` except `/lists` (the nominal home).
 */
export function HomeFab() {
  const pathname = usePathname();
  const isHome =
    pathname === "/lists" || pathname === "/" || pathname === "/app";
  if (isHome) return null;
  return (
    <Link
      href="/lists"
      aria-label="Listelere dön"
      className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-transform active:scale-95"
      style={{
        background: "var(--lb-accent)",
        color: "var(--lb-accent-fg, white)",
      }}
    >
      <Home width={20} height={20} aria-hidden />
    </Link>
  );
}
