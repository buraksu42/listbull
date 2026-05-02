/**
 * Server-only assertion stub.
 *
 * The npm `server-only` package throws by design. Next.js's bundler
 * aliases it to a no-op for server bundles, but tsx (used by the cron
 * container) doesn't — so any module that does `import "server-only"`
 * crashes at runtime when reached transitively from the cron entry.
 *
 * tsconfig.json maps `server-only` → this stub for tsx + Next type
 * checking. Next's runtime bundler still uses the real package on the
 * web app surface (its own resolver wins; this alias is only consulted
 * by tsx and tsc).
 *
 * The defensive intent (server modules must not run in client bundles)
 * is preserved by the App Router's `"use client"` boundary plus the
 * folder ownership rules in CLAUDE.md.
 */
export {};
