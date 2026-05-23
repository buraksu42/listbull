"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark, TelegramIcon } from "@/components/marketing/BrandMark";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/commands", label: "Commands" },
  { href: "/security", label: "Security" },
];

/**
 * Sticky top header with backdrop-blur. Gains a border-bottom once
 * the user has scrolled past the first ~4 pixels, matching the
 * Linear / Vercel pattern.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled((window.scrollY || 0) > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`site-header${scrolled ? " is-scrolled" : ""}`}
      id="site-header"
    >
      <div className="container header-row">
        <Link href="/" className="wordmark" aria-label="listbull home">
          <BrandMark className="mark" />
          <span className="wordmark-text">listbull</span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "is-active" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href="https://github.com/buraksu42/listbull"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <a
          className="header-cta"
          href="https://t.me/listbull_bot"
          target="_blank"
          rel="noopener noreferrer"
        >
          <TelegramIcon />
          Try @listbull_bot
        </a>
      </div>
    </header>
  );
}
