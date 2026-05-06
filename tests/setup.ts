/**
 * Vitest setup — runs once before any unit test. Two jobs:
 *
 *   1. Stub the `server-only` module so files that import it
 *      (e.g. `src/lib/server/encryption.ts`) load under Vitest. The
 *      package itself throws when imported from a client-context
 *      bundler; we don't have a bundler here, but the module's default
 *      export is undefined under Vitest's resolution so we shim it.
 *
 *   2. Inject placeholder env vars the modules under test read at
 *      import time. Real values live in `.env.local` for dev / Dokploy
 *      for prod; the unit suite must be self-contained.
 */
import { vi } from "vitest";

// (1) `server-only` shim — the published package merely throws at load
// time when bundled for the client. Vitest's resolution still tries to
// load the file; we provide a no-op module instead.
vi.mock("server-only", () => ({}));

// (2) Env stubs — minimum surface for `src/lib/env.ts` to validate.
// `process.env.NODE_ENV` is read-only in @types/node 22 strict mode;
// route through `Object.assign` to skirt the literal-property guard.
Object.assign(process.env, {
  NODE_ENV: process.env.NODE_ENV ?? "test",
});
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? "x".repeat(48);
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
// 32 raw bytes — encryption.ts trims to 32. Anything ≥32 chars works.
process.env.ENV_KEY =
  process.env.ENV_KEY ?? "0123456789abcdef0123456789abcdef";
process.env.TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ?? "0000000000:test-token-stub-for-vitest";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "x".repeat(32);
process.env.TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ?? "listbull_bot";
process.env.NEXT_PUBLIC_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
process.env.NEXT_PUBLIC_ENV = process.env.NEXT_PUBLIC_ENV ?? "test";
process.env.SKIP_ENV_VALIDATION = "0";
